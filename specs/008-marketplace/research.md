# Phase 0 Research: Member Marketplace

**Feature**: 008-marketplace | **Date**: 2026-09-21

Findings verified against this repository, not taken from general practice.

---

## R1. This lands in the middle of the TypeScript migration

**Decision**: Build the marketplace in TypeScript, **with** Zod schemas on every
route, exactly as the rest of the server does today. Accept that feature 007
Phase 6 will then have to remove them, and say so up front.

**Rationale**: Feature 007 is half-finished and the half that is done matters here.

| | State today |
|---|---|
| `packages/contracts`, `client` | TypeScript, **0** type errors |
| `server` | TypeScript, runs, **1225** strict type errors outstanding |
| Zod | **fully present**; Phase 6 not started |
| Response-schema boot gate | **amended away** in `11-rbac.ts` (constitution 2.0.0) |
| `config.auth` boot gate | **still enforced** |

Two consequences the plan has to carry rather than discover:

1. **`config.auth` is still mandatory.** Every marketplace route declares it or
   the server does not boot. That is free and is FR-019.
2. **The response-schema gate is already gone**, so new routes are *not* forced
   to declare `schema.response`. They should anyway, while Zod is still here:
   the alternative is writing the one part of the codebase that never had
   response serialization, and then Phase 6 has nothing to remove from it and no
   record that it once existed.

**The cost, stated plainly**: every schema this feature adds becomes work for
007's Phase 6, and every business rule expressed *inside* one joins the 21 rules
in `specs/007-typescript-migration/data-model.md` §4 that must survive removal.
The marketplace adds a lot of them — category-required fields, price bounds,
photo counts. That list should be updated as part of this feature, not left for
whoever runs Phase 6 to rediscover.

**Alternatives considered**:

- *Wait for 007 to finish.* Cleanest sequencing and it was rejected on schedule
  grounds alone — 1225 errors plus all of Phase 6 is a long block. Worth
  reconsidering if the marketplace is not urgent, because building a large
  feature against a codebase that is mid-rewrite doubles the surface that Phase 6
  touches.
- *Write it Zod-free now, ahead of Phase 6.* Tempting, and wrong while every
  neighbouring module still validates: it would be the only module accepting
  unshaped input, and nothing would mark it as a deliberate choice rather than an
  omission.

---

## R2. Category-specific fields: one table per category

**Decision**: A common `marketplace_listings` table plus **four** detail tables —
`marketplace_vehicle_details`, `marketplace_property_details`,
`marketplace_job_details`, `marketplace_general_details` — each one-to-one,
primary key = `listing_id`.

**Rationale**: §7's structured categories have genuinely different, genuinely
*structured* fields that the index must filter on: price and make for vehicles,
rooms and size for property, location and seniority for jobs. Filtering is the
requirement that decides this (FR-010).

The common table carries what every listing has and what the unfiltered index
reads — category, mode, title, state, owner, timestamps. A category filter joins
exactly one detail table; the "all categories" view joins none. There is no query
that needs two of them at once.

Detail rows are deleted and re-inserted when a listing changes category, which
answers the edge case about stale fields lingering: they cannot, because the row
holding them is gone.

**Alternatives considered**:

- *One wide table with nullable columns.* ~60 columns, most null on any row, a
  migration per new field, and no way for the database to say that `rooms` is
  meaningless on a job. Simplest to query and the least honest.
- *JSONB `attributes` column.* No migration per field, which is the real
  attraction. Rejected as the primary structure: filtering on numeric ranges
  inside JSONB needs expression indexes per field — so the migration comes back,
  just uglier — and Principle IV asks for invariants in the database, not in a
  document the database cannot read. Still the right tool for R3.
**`general` (added 2026-09-22)** is the exception that proves the rule: it has
almost no structure, because it exists so an arbitrary product or service has
somewhere to go. Giving it a detail table anyway keeps one shape — every
category has exactly one detail row — rather than a special case where `general`
has none.

- *Single-table inheritance with a discriminator and CHECK constraints per
  category.* Enforces shape in the database, which is attractive, but the CHECK
  expressions become unreadable at ~40 vehicle fields.

---

## R3. The ~40 vehicle checkboxes: lookup table plus join table

**Decision**: `vehicle_features` (the catalogue) and
`marketplace_vehicle_features` (listing_id, feature_id). Not 40 boolean columns,
not a `text[]`.

**Rationale**: This is the one place §7 names a number, and the number is the
argument. Forty booleans is forty columns and a migration every time the club
adds "roof box". The join table costs one extra table and buys three things:

1. **No migration per checkbox.** A new feature is a row.
2. **The database rejects an unknown feature**, by foreign key. A `text[]` with a
   CHECK against a literal list is the same migration problem wearing an array,
   and without the CHECK a typo becomes a feature nobody can ever filter on.
3. **Staff-editable where the business owns it.** The Development Workflow
   section requires that presentation attributes staff are accountable for be
   editable under the permission system rather than needing engineering. A
   catalogue table is that; a column list is not.

Filtering "has all of these features" is `GROUP BY ... HAVING count(*) = n`, or a
`@>` against an array aggregate. Both index fine at classifieds scale.

**Alternatives considered**:

- *40 boolean columns.* Trivially fast, and the migration treadmill is the point
  of §7 naming "~40" — it will change.
- *`text[]` with a GIN index.* Genuinely good for the query, and it cannot answer
  "what features exist?" without scanning every listing, which is what the
  compose form needs.

---

## R4. Listing state machine

**Decision**: `draft → active → (sold | filled | withdrawn | expired)`, plus
`hidden` reachable from `active` by moderation only. Stored as a PostgreSQL enum,
following `016_events.sql`.

**Rationale**: Each state answers a question the spec asks. `sold`/`filled`
distinguishes "it worked" from `withdrawn`'s "never mind" — worth keeping apart
because it is the only signal the marketplace is useful. `expired` is set by a
job, not computed at read time, so the index query stays a simple predicate.
`hidden` is separate from `withdrawn` because US4.4 requires the owner to see
that it was hidden rather than find it silently gone.

Members never hard-delete (FR-005), consistent with how the platform treats
member data everywhere else.

**Expiry is optional (resolved 2026-09-22)**. `expires_at` NULL means *unlimited*
and is a first-class choice, not a missing value. The job's predicate is
therefore `expires_at IS NOT NULL AND expires_at <= now()`, and SC-012 asserts
both halves — that a listing with no expiry survives the job, and one with a past
expiry does not. A job whose `WHERE` clause forgot the null check would quietly
expire every unlimited listing, which is the failure worth a named test.

**Alternatives considered**: computing expiry from `expires_at` at read time —
one fewer job, but every index query grows a time predicate, the state column
stops being the truth, and the null case has to be handled at every call site
instead of one.

---

## R5. Quotas

**Decision**: Add `SCOPE.MARKETPLACE_LISTINGS = 'marketplace.listings'` to
`db/counters.ts` and reserve under the existing row lock. Photos continue to
count against `SCOPE.STORED_BYTES`, which already exists and needs no change.

**Rationale**: `db/counters.ts` already does exactly this, correctly, under a row
lock, and CLAUDE.md is explicit that a business quota is 422 and not 429 because
retrying changes nothing until state does. A listing cap is that. SC-005 asserts
it under real concurrency because a quota checked without a lock is, in CLAUDE.md's
words, a race condition with extra steps.

---

## R6. Photos

**Decision**: Reuse `modules/media` unchanged. `marketplace_listing_media`
holds `(listing_id, asset_id, position)`. No new pipeline, no new validation.

**Resolved 2026-09-22**: a listing may carry one photo, several photos, or a
video (FR-039). `ASSET_KINDS` is already `['image', 'video']` and the `poster`
and `video` variants already exist, so this widens what the marketplace asks of
the pipeline rather than changing the pipeline.

**Rationale**: The media pipeline already does content inspection by magic bytes,
strips metadata, derives at declared breakpoints and never serves the original —
which is FR-013, FR-014 and SC-004 satisfied by using it rather than by writing
anything. Deleting a listing deletes its links, never the bytes: another listing
may share the checksum, and `media/routes` is already the only place that decides
whether bytes go.

`position` is explicit rather than implied by insertion order, because the first
item represents the listing in the index — and for a video that means its
`poster` variant, so a browse page never autoplays and never waits on a
transcode.

---

## R7. Visibility cascade from member status

**Decision**: The member index filters on the owner's status, joined at query
time. Listings are not rewritten when a member's status changes.

**Rationale**: §3.2 already decides that `locked`, `inactive` and `ended` members
cannot sign in; their listings should not keep selling. Doing it by join means
the rule has one home and a reinstated member's listings return automatically. A
status-change fan-out that rewrites listing rows would have to be replayed on
reinstatement, and would drift the moment anything else changed status.

This costs a join on the hottest query in the feature, which is the trade and
which the index in R8 has to account for.

**Alternatives considered**: a denormalised `owner_visible` flag maintained by
trigger — faster reads, and it is a cached copy of live state, which Principle III
is specifically about not doing.

---

## R8. Filtering, pagination and indexes

**Decision**: Keyset pagination on `(created_at, id)`, bounded page size, with a
partial index on the active set.

**Rationale**: Keyset over offset because a classifieds index is append-heavy and
offset pagination skips or repeats rows as listings arrive mid-scroll. A partial
index (`WHERE state = 'active'`) is small, because it indexes only what the index
query reads.

**Bounded page size is not optional here**, and the reason is recorded in feature
007: `specs/007-typescript-migration/data-model.md` §4b traces `campaignQuery.limit`
from `request.query` into a SQL `LIMIT` and notes that removing its Zod schema
without replacing the coercion yields `"50"` as a string, `undefined` when
absent, and no upper bound. This feature adds a second such parameter. It must be
coerced and bounded in the handler, not only in a schema that Phase 6 deletes.

---

## R9. Contact method and privacy

**Decision**: A listing stores a contact *preference*, never a contact *value*.
The server resolves the preference against the owner's §7 privacy settings when
rendering, and omits what the settings do not permit.

**Rationale**: §7 lists the privacy controls and marketplace inquiry among the
notification types in the same breath as the marketplace itself. Copying an email
address onto a listing row makes the listing a second, stale, unprotected home
for it — and a member tightening their privacy settings would not retroactively
protect listings already posted. Resolving at render time means the settings are
always the live answer, which is Principle III applied to personal data.

**Resolved 2026-09-22**: the preference set is led by `platform_message`, and
this feature builds the messaging persistence behind it (R13). `email_relay` and
`phone` remain in the enum for members who prefer them, gated by the same privacy
settings. The enum can gain values without a data migration, which matters once
real-time messaging lands.

---

## R10. Moderation and reports

**Decision**: `marketplace_reports (listing_id, reporter_id, reason, state)`.
Staff act through the existing `marketplace_moderation` module and its five flags:
`read` to see the queue, `status` to hide or restore, `delete` to remove.

**Rationale**: The module already exists in `MODULES` and already appears in the
admin sidebar — it renders the "not available yet" panel added in the console
routing fix. Nothing new is needed in the permission system; this feature fills a
hole the matrix already has.

Every action goes through `app.audit`, which is append-only by revoked grant
rather than by convention (Principle IV), so FR-018 and SC-007 come from using it.

---

## R11. Terms acceptance

**Decision**: `marketplace_terms_acceptances (member_id, version, accepted_at)`,
and the create path refuses when the member's latest accepted version is not the
current one.

**Rationale**: §7 requires acceptance of terms to post. A boolean on the member
row answers "did they ever accept?", which stops being the right question the
first time the terms change. Versioning it is the difference between a record and
a checkbox.

---

## R12. Console surface

**Decision**: Two surfaces — a member marketplace, and a staff moderation screen
at `/konsole/admin/angebote`, which is already in `ADMIN_ITEMS` gated on
`marketplace_moderation`.

**Rationale**: That sidebar entry exists and currently renders `NotBuilt`. This
feature is what replaces it.

**Resolved 2026-09-22**: there are **three** surfaces, not two.

| Surface | Where | Audience |
|---|---|---|
| Staff moderation | `/konsole/admin/angebote` — replaces `NotBuilt` | staff |
| Member web | a new tab in the member area, under the path `HOME_FOR_KIND` already maps members to | member |
| Member mobile | a new `NativeTabs.Trigger` in `expo-client` | member |

All three call **one** member-or-staff API. `HOME_FOR_KIND` already maps `member`
to a member area, so the web tab has a home; what does not exist yet is the member
console area itself, which this feature creates alongside the tab.

All interface strings go in `client/src/i18n/{de,en}.ts` through
`useTranslations()`; `tests/no-hardcoded-strings.test.tsx` refuses a component
that imports a catalogue directly, and `npm run -w client test:i18n` fails the
build when the two catalogues disagree in either direction.

---

## R13. Messaging: persistence now, real-time later

**Decision**: Build conversations, messages and the marketplace inquiry entry
point. Delivery is on read. WebSocket transport, typing indicators and read
receipts are a separate, later feature.

**Rationale**: The split is not a compromise — it is the order the Technology &
Security Baseline already states:

> Real-time transport is additive — a message MUST be persisted before it is
> delivered, so a dropped connection never loses data.

Persistence is therefore the substrate and real-time is a delivery mechanism over
it. Building the transport first would invert that and make durability a property
of a connection.

Two consequences worth stating:

1. **The marketplace gets a real contact method now**, rather than a placeholder
   that has to be migrated when messaging arrives.
2. **The later real-time feature adds no tables.** It attaches a transport to
   rows that already exist, which is what "additive" means.

Scope here is deliberately narrow: a conversation linked to a listing, messages
within it, and the two endpoints the marketplace needs. Threads, group
conversations, system notifications and the §7 notification opt-in matrix are
not in this feature, and the schema should not pretend to model them.

**Alternatives considered**:

- *Full §7 messaging in this feature.* Roughly doubles it and makes the
  marketplace's release date depend on the real-time stack.
- *Messaging as its own feature first.* Cleanest dependency order, and worth
  revisiting if threads and contacts are scheduled soon, since both need the same
  substrate. Rejected on sequencing: the marketplace would wait on a feature it
  only needs a corner of.
- *A placeholder contact method — show an email address.* Rejected on R9's
  grounds: it makes the listing a second, stale home for personal data that a
  later privacy change cannot reach.

---

## R14. The mobile app is a scaffold, and that is prerequisite work

**Decision**: Before a marketplace tab, `expo-client/german-world-club` needs
three things: workspace membership, `@gwc/contracts`, and bearer-token
authentication. Size them as tasks rather than folding them into "add a tab".

**Rationale**: Verified against the repository, not assumed:

| Checked | Finding |
|---|---|
| npm workspaces | `["server", "client", "packages/*"]` — **expo-client is outside** |
| `@gwc/contracts` dependency | **absent** from its package.json |
| API calls anywhere in `src/` | **none** |
| Authentication | **none** |
| Tabs today | two placeholders, `index` and `explore` |

So the app is a working Expo Router scaffold with themed components and native
tabs, and nothing that talks to this platform.

**Workspace membership is the load-bearing one.** Principle I requires request
and response types to live in one shared package *that every client imports*. A
mobile client that redeclared the listing shape would be the exact divergence the
package exists to prevent — and after feature 007 Phase 6 removes the runtime
schemas, nothing would catch the drift at runtime either. Adding
`expo-client/german-world-club` to `workspaces` is what makes FR-032 possible.

**Authentication second.** The platform already mints bearer tokens for the
mobile face and the auth routes already handle `deviceId` — `sign-in` treats its
presence as marking the mobile face, and the device-approval and OTP branches
exist for it. So this is wiring an existing server capability to a client that
has never used it, not designing an auth flow.

**Alternatives considered**:

- *Copy the types into the Expo app.* Fastest, and it is precisely the second
  home for a rule that Principle I forbids.
- *Ship the web tab first and defer mobile.* Reasonable, and the reason US6 is
  P2 rather than P1. The prerequisite work is real either way; deferring only
  moves when it is paid.
