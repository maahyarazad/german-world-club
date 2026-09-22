# Phase 1 Data Model: Member Marketplace

**Feature**: 008-marketplace | **Date**: 2026-09-21

Schema for `018_messaging.sql` and `019_marketplace.sql`. Shapes and constraints,
not DDL — the DDL is an implementation task. Conventions follow `016_events.sql`: enums in a guarded
`DO $$`, `citext` for anything compared case-insensitively, `timestamptz`
throughout.

---

## 1. Enums

```
marketplace_category  : vehicle | property | job
marketplace_mode      : offer | request
marketplace_state     : draft | active | sold | filled | withdrawn | expired | hidden
marketplace_contact   : platform_message | email_relay | phone
report_state          : open | upheld | dismissed
```

`sold` and `filled` are both terminal successes and both exist because they are
not the same event — a vehicle sells, a job is filled — and distinguishing them
is the only signal that the marketplace works (research.md R4).

`hidden` is reachable only by moderation, and only from `active`. It is separate
from `withdrawn` so the owner can see that it was hidden rather than find it
silently gone (spec US4.4).

`marketplace_contact` will gain values when messaging exists. An enum, not a
lookup table, because the *server* must know what each means — unlike vehicle
features, which are data the server never branches on.

---

## 2. `marketplace_listings` — the common table

The only table the unfiltered index reads.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `owner_id` | uuid NOT NULL → `members(id)` | ON DELETE RESTRICT — members are never deleted |
| `category` | `marketplace_category` NOT NULL | decides which detail table has the row |
| `mode` | `marketplace_mode` NOT NULL | FR-007 |
| `title` | text NOT NULL | |
| `body` | text NOT NULL | stored raw so partner auto-linking (§2) stays possible |
| `state` | `marketplace_state` NOT NULL DEFAULT `draft` | |
| `contact_method` | `marketplace_contact` NOT NULL | a *preference*, never a value — R9 |
| `terms_version` | text NOT NULL | the version accepted at post time, denormalised on purpose: it records what they agreed to *then* |
| `created_at` / `updated_at` | timestamptz NOT NULL | |
| `published_at` | timestamptz NULL | set on first transition to `active` |
| `expires_at` | timestamptz NULL | **NULL means unlimited** — a first-class choice, not a missing value (FR-028). A job flips `state`; not computed at read time (R4) |
| `state_changed_at` | timestamptz NOT NULL | feature 005's consistent-history rule needs this to seed history at the fact's own timestamp |

**Constraints**

- `CHECK (state <> 'active' OR published_at IS NOT NULL)` — an active listing has
  a publication time or the index sorts on null.
- `CHECK (expires_at IS NULL OR expires_at > published_at)` — an expiry already
  past at publication is a data-entry error, not a listing.
- `title` and `body` length bounds. **These are business rules living in a
  constraint, and deliberately so**: after 007 Phase 6 removes the Zod schema,
  the database is what is left. Same reasoning as the 21 preserved rules in
  `specs/007-typescript-migration/data-model.md` §4.

**Indexes**

- `(state, created_at DESC, id DESC) WHERE state = 'active'` — partial, for the
  keyset index query (R8). Small, because it indexes only what that query reads.
- `(owner_id, state_changed_at DESC)` — "my listings", which must include hidden
  and withdrawn ones.
- `(category, state, created_at DESC) WHERE state = 'active'` — the category
  filter, which is the common case.

---

## 3. Detail tables — one per category

Each is one-to-one with `marketplace_listings`, PK **and** FK `listing_id`, with
`ON DELETE CASCADE`. A category change deletes the old row and inserts a new one,
which is why stale fields cannot linger (spec edge case).

### 3a. `marketplace_vehicle_details`

`make`, `model`, `year`, `mileage_km`, `price_minor`, `currency`,
`fuel`, `transmission`, `body_type`, `condition`.

Price is **integer minor units**, matching the platform's existing rule that
money crosses the wire as integer cents because a float cannot represent it
exactly. `client/src/lib/format.ts` already divides by 100 in one place.

### 3b. `marketplace_property_details`

`deal` (rent | sale), `rooms` numeric(4,1) — half-rooms are a real German
convention, `size_sqm`, `price_minor`, `currency`, `city`, `postal_code`,
`available_from`.

`deal` is category-specific and NOT the same axis as `mode`: a *request* to *rent*
is a coherent listing, and collapsing the two would make it unexpressible.

### 3c. `marketplace_job_details`

`employment_type`, `seniority`, `department`, `city`, `remote` (onsite | hybrid |
remote), `salary_min_minor`, `salary_max_minor`, `currency`.

**Filter indexes**: each detail table indexes what its category filters on —
vehicles on `(price_minor)` and `(make)`, property on `(deal, city)` and
`(rooms)`, jobs on `(city, seniority)`.

---

## 4. Vehicle features — catalogue plus join (R3)

### `vehicle_features`

| Column | Type | Notes |
|---|---|---|
| `id` | smallint PK | small and stable; it is a join key on a hot table |
| `key` | citext NOT NULL UNIQUE | stable identifier, never shown |
| `group` | text NOT NULL | comfort / safety / media — the compose form's sections |
| `position` | integer NOT NULL | display order is a business decision, not alphabetical |
| `retired_at` | timestamptz NULL | **soft-retire, never delete** |

`retired_at` rather than `DELETE`: removing a feature row would orphan or cascade
away the fact that a listing had it. A retired feature stops being offered on new
listings and still renders on old ones. This is the same instinct as the
platform's soft-delete rule for members.

Display labels live in `client/src/i18n/{de,en}.ts` keyed by `key`, not in this
table — the server emits no localised text, and
`tests/ops/no-server-localisation.test.ts` asserts no response body varies with
`Accept-Language`.

### `marketplace_vehicle_features`

`(listing_id, feature_id)` composite PK, both FKs, cascade on listing delete.
Index on `(feature_id, listing_id)` for "listings having this feature".

"Has all of these" is `GROUP BY listing_id HAVING count(*) = $n`.

---

## 5. `marketplace_listing_photos`

`(listing_id, asset_id, position)`, composite PK `(listing_id, position)`.

`asset_id` → `assets(id)`. **`ON DELETE RESTRICT`, not CASCADE** — deleting a
listing removes these rows, never the bytes, because another listing may share
the checksum and `media/routes` is the only place that decides whether bytes go
(research.md R6).

`position` is explicit because the first photo represents the listing in the
index. A photo count bound belongs here as a constraint, for the same
after-Phase-6 reason as §2.

---

## 6. `marketplace_reports`

`id`, `listing_id` → listings, `reporter_id` → members, `reason` text NOT NULL,
`state` `report_state` DEFAULT `open`, `created_at`, `resolved_at`,
`resolved_by` → `admin_users(id)`.

Unique on `(listing_id, reporter_id)` where `state = 'open'` — one open report per
member per listing, so a single complainant cannot flood the queue.

Reports are evidence and are never deleted; `dismissed` is a state.

---

## 7. `marketplace_terms_acceptances`

`(member_id, version, accepted_at)`, PK `(member_id, version)`.

Append-only. A member who accepts v2 keeps their v1 row — the record of what they
agreed to when they posted their earlier listings, which is why
`marketplace_listings.terms_version` is denormalised rather than joined.

---

## 7b. Messaging — `018_messaging.sql`

Its own migration and its own module. Messaging outlives this feature: threads,
contacts and system notifications all ride the same substrate later (§7). The
marketplace is simply its first caller.

**Scope here is narrow on purpose** — a conversation, its participants, its
messages, and the two endpoints the marketplace needs. Group conversations,
typing state, read receipts and the §7 notification opt-in matrix are *not*
modelled. A schema that pretended to model them would be guessing at a feature
nobody has specified.

### `conversations`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `subject_type` | text NOT NULL | `marketplace_listing` today; the seam for threads later |
| `subject_id` | uuid NULL | the listing that started it |
| `created_at` | timestamptz NOT NULL | |
| `last_message_at` | timestamptz NOT NULL | denormalised **ordering key**, not content — the inbox sorts on it and the alternative is a correlated subquery per row |

`subject_type` + `subject_id` rather than a hard FK to listings: the next caller
is threads, and a nullable `listing_id` column would have to be joined by every
future one. The trade is that the database cannot enforce the reference, so the
application must — stated plainly rather than discovered.

### `conversation_participants`

`(conversation_id, member_id)` composite PK, both FKs. `last_read_at` timestamptz
NULL — enough to compute an unread count without modelling read receipts.

Two rows per marketplace conversation. The table exists rather than two columns
on `conversations` because group conversations are named in §7, and this is the
one place where anticipating them costs nothing.

### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `conversation_id` | uuid NOT NULL → conversations | ON DELETE CASCADE |
| `sender_id` | uuid NOT NULL → members | RESTRICT — members are never deleted |
| `body` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | |

Index `(conversation_id, created_at DESC, id DESC)` — keyset paging within a
conversation, same reasoning as R8.

**No `delivered_at` or `read_at` column.** Delivery is on read in this feature,
and a column that nothing writes is a promise the schema cannot keep. Real-time
adds them when it adds the transport that can set them.

**The ordering constraint that matters**: a message row is committed **before**
any notification is attempted (FR-025). The Technology Baseline requires it, and
SC-011 asserts it by failing the notification path and confirming the message is
still there. Notification is therefore a separate step after commit, never part
of the same transaction — a transaction that rolled back on a failed push would
lose a message the sender saw accepted.

### No contact values, anywhere

Neither table carries an email address or a phone number, and no response derived
from them may either (FR-026). The listing stores a contact *preference*; the
conversation is how the preference is honoured. This is R9's rule reaching the
messaging schema, and it is why the marketplace does not simply display an email.

---

## 8. What this feature does NOT add

Recorded because the absence is deliberate:

- **No new permission.** `marketplace_post` and `marketplace_moderation` both
  already exist.
- **No crawl-posture change.** `seo/surfaces.ts` already declares `/marketplace`
  gated and never-indexed.
- **No media pipeline change.** Reused as-is.
- **No payment, order or escrow.** §7 is classifieds with a contact method.
- **No contact value stored anywhere.** R9, and §7b.
- **No real-time transport, typing state or read receipts.** Additive, later
  (R13). No table here is shaped around their absence.
- **No group conversations.** `conversation_participants` makes them possible
  without modelling them.

---

## 9. State transitions

```
draft ──publish──> active ──┬── owner: sold | filled | withdrawn
                            ├── job:   expired
                            └── staff: hidden ──restore──> active
```

- Only the owner reaches `sold`, `filled`, `withdrawn`; enforced against the
  loaded row inside the transaction (FR-003).
- Only `marketplace_moderation:status` reaches `hidden` and back.
- `expired` is set by a scheduled job, individually enableable with its run
  recorded start/end/outcome, as the Workflow section requires of every job.
  Its predicate is `expires_at IS NOT NULL AND expires_at <= now()` — **both
  halves**. A job that forgot the null check would silently expire every
  unlimited listing, which is why SC-012 asserts the negative case too.
- A member may change or clear their own expiry at any time, including back to
  unlimited (FR-030).
- Every transition writes `state_changed_at` and an audit entry.
- No transition out of a terminal state except `hidden → active`. A sold listing
  is not re-posted; a new listing is.

---

## 10. Seed expectations (SC-009)

`seed:demo` must span **every** category, **both** modes and **every** state,
following feature 005's rule that the spread is the point — six identical
published listings demonstrate nothing about how visibility works.

Under the consistent-history rule, a listing whose state is `sold` gets its
history entry at its own `state_changed_at` with its own value. Nothing gets
invented history.

`marketplace_terms_acceptances` is seedable — it is a record, not a credential.
It does **not** join the never-seeded list in `src/seed/tables.ts`, which is
about live credentials.
