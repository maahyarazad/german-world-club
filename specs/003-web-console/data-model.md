# Phase 1 Data Model: GWC Web Console

**Feature**: 003-web-console | **Date**: 2026-09-17

Entities the console needs that do not exist yet. Existing tables (`members`, `admin_users`,
`admin_permissions`, `sessions`, `refresh_tokens`, `assets`, `asset_variants`, `seo_metadata`,
`audit_log`, `counters`, `push_*`, `job_*`) are referenced, not redefined.

Constitution Principle IV governs everything below: correctness-critical invariants are database
constraints, not application checks.

---

## 1. Principals and organisations

### `organisations`

A club merchant or a corporate club partner. One row per commercial counterparty.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `kind` | `organisation_kind` | `merchant` \| `partner`. Fixed at creation; a merchant never becomes a partner. |
| `legal_name` | text not null | |
| `slug` | citext unique not null | Public URLs are slug-based (Principle III). |
| `status` | `organisation_status` not null | `pending` \| `active` \| `suspended` \| `ended`. Only `active` may publish. |
| `status_changed_at` | timestamptz not null | |
| `contract_start` / `contract_end` | date | A lapsed contract must not leave content published (Principle III). |
| `fee_tier` | text | The banded fee from the design document. Recorded, never computed by a client. |
| `location_count` / `employee_count` | integer | Drives the fee band. Merchant uses locations, partner uses employees. |
| `created_at` | timestamptz not null | |

- **Constraint**: `location_count` is null for `partner`, `employee_count` is null for `merchant`.
- **Constraint**: `contract_end >= contract_start`.
- **Refuses delete**, like `members` — ending a relationship is a status transition that preserves
  history, enforced by trigger so it survives an ad-hoc query.

### `organisation_users`

A person who signs in on behalf of an organisation. The merchant and partner principal kinds of
research R4.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `organisation_id` | uuid fk → `organisations` not null | |
| `email` | citext not null | Unique per organisation, not globally — the same person may act for two. |
| `password_hash` | text | Null means no usable password; sign-in is refused rather than falling back. |
| `role` | `organisation_role` not null | `owner` \| `manager` \| `staff`. Scopes what they may do *within* their own organisation only. |
| `status` | `member_status` not null | Reuses the existing enum; only `active` may sign in. |
| `last_login_at` | timestamptz | |

- **Unique** `(organisation_id, email)`.
- **Constraint**: an organisation always retains at least one active `owner` — trigger-enforced,
  mirroring the existing last-superadmin guard on `admin_users`.
- **Scoping invariant**: every query an organisation principal makes is filtered by their
  `organisation_id`. Route-level audience cannot express this; it is an object guard enforced
  inside the transaction (Principle II).

### `employee_entitlements`

A corporate partner's grant of benefit access to a named employee. **Not a membership** (FR-030).

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `organisation_id` | uuid fk not null | Must reference an organisation of kind `partner`. |
| `email` | citext not null | |
| `state` | `entitlement_state` not null | `invited` \| `activated` \| `revoked` \| `expired`. |
| `invited_at` / `activated_at` / `revoked_at` | timestamptz | |
| `member_id` | uuid fk → `members` | Null unless that person is *separately* also a member. |

- **Unique** `(organisation_id, email)`.
- **Constraint**: the referenced organisation's `kind` is `partner` — enforced by a composite
  foreign key onto `(id, kind)`, not by application check.
- **Invariant, stated as a test rather than a constraint**: creating an entitlement never inserts
  into `members`. This is the rule FR-030 exists for and the one most likely to be violated by a
  well-meaning later change.
- **Count invariant**: activated entitlements must not exceed the contracted `employee_count`.
  A quota, not a rate limit — so it lives under a row lock via the existing `db/counters.js`,
  exact under concurrency and surviving a Redis flush.

---

## 2. Submissions and approval

The single mechanism of research R6, used by every module that publishes.

### `submissions`

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `subject_type` | `submission_subject` not null | `offer` \| `vacancy` \| `article` \| `event` \| `product`. |
| `subject_id` | uuid not null | The row awaiting a decision. |
| `organisation_id` | uuid fk | Null for staff-authored subjects. |
| `state` | `submission_state` not null | `draft` \| `pending` \| `changes_requested` \| `approved` \| `rejected` \| `withdrawn`. |
| `current_version` | integer not null | |
| `required_module` | text not null | Which permission module decides it. Must be a value in the shared `MODULES` list. |
| `submitted_at` / `decided_at` | timestamptz | |

- **Unique** `(subject_type, subject_id)` — one open submission per subject.
- **Constraint**: `state = 'approved'` requires a non-null `decided_at`.
- **Constraint**: `required_module` is checked against the shared module list, so a submission
  cannot be routed to a queue no grant can open.

### `submission_versions`

Append-only. What the decision was made *about*.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `submission_id` | uuid fk not null | |
| `version` | integer not null | |
| `payload` | jsonb not null | The member-facing shape at that version, so the staff preview is provably what published. |
| `created_at` | timestamptz not null | |
| `created_by_kind` / `created_by_id` | | |

- **Unique** `(submission_id, version)`.
- **Append-only**, enforced by revoked `UPDATE`/`DELETE` grants rather than by convention
  (Principle IV).

### `submission_decisions`

Append-only. FR-024's audit guarantee.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `submission_id` | uuid fk not null | |
| `version` | integer not null | The version decided on — not "the latest". |
| `decision` | `submission_decision` not null | `approve` \| `request_changes` \| `reject`. |
| `comment` | text | Required when `request_changes` or `reject`. |
| `decided_by_admin_id` | uuid fk → `admin_users` not null | Only staff decide. |
| `decided_at` | timestamptz not null | |

- **Constraint**: `comment` is non-empty unless `decision = 'approve'`.
- **Foreign key** `(submission_id, version)` → `submission_versions`, so a decision cannot point at
  a version that never existed.
- **Append-only**, same enforcement as above.

**State transitions**:

```
draft ──submit──► pending ──approve────────► approved
                    │
                    ├──request_changes──► changes_requested ──submit──► pending
                    └──reject───────────► rejected
draft | changes_requested ──withdraw──► withdrawn
```

Every transition writes a row to `audit_log`. `approved → *` requires a new version, so an approved
thing cannot be silently edited after the fact.

---

## 3. Merchant domain

### `merchant_locations`

`id`, `organisation_id` (fk, kind must be `merchant`), `label`, address fields, `lat`/`lon`,
`status`. The row count is what drives the fee band, so it is counted, not asserted.

### `offers`

A benefit to members. The design document's non-negotiable is that the advantage be *checkable*:
FR-028 requires regular price, GWC price, availability, locations, validity and conditions to all
be present, so each is a column and not an optional blob.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `organisation_id` | uuid fk not null | kind must be `merchant`. |
| `title` / `description` | text not null | |
| `regular_price_cents` / `member_price_cents` | integer | |
| `currency` | char(3) | |
| `benefit_kind` | `benefit_kind` not null | `percentage` \| `fixed_amount` \| `member_price` \| `value_add`. |
| `benefit_value` | numeric | |
| `valid_from` / `valid_until` | timestamptz not null | |
| `conditions` | text | |
| `min_tier` | `membership_tier` | Which tier may redeem. |
| `published_at` | timestamptz | Null until approved. |

- **Constraint**: `valid_until > valid_from`.
- **Constraint**: a percentage benefit is `> 0 and <= 100`.
- **Constraint** (the design document's merchant rule 1, *"echter Vorteil - nicht Normalpreis als
  Rabatt etikettieren"*): where both prices are present, `member_price_cents < regular_price_cents`.
  This is the one business rule the mockups state twice, so it is a database constraint.
- **Visibility**: an offer is visible to members only when `published_at is not null`, its
  organisation is `active`, and `now()` is inside its validity window. Expiry is therefore a query
  predicate, not a scheduled job — FR-025 holds with no staff action and no cron.

### `redemptions`

`id`, `offer_id`, `member_id`, `redeemed_at`, `reference` (unique — a deterministic reference so a
retry cannot duplicate the effect, Principle IV), `estimated_saving_cents`.

- **Unique** `reference`.
- Feeds the member value ledger and the merchant's aggregate analytics.

### `redemption_feedback`

`id`, `redemption_id` (unique — one feedback per redemption), `benefit_real` boolean,
`price_correct` boolean, `quality_rating` smallint 1–5, `comment`, `created_at`.

The three questions are exactly the mockup's: *"Vorteil real?"*, *"Preis korrekt?"*, *"Service
verlässlich?"*.

---

## 4. Partner domain

### `vacancies`

`id`, `organisation_id` (kind `partner`), `title`, `description`, `location`, `employment_type`,
`published_at`, `closes_at`. Publishes through `submissions`.

### `partner_articles`

`id`, `organisation_id`, `title`, `body`, `kind` (`newsletter_article` \| `company_feature` \|
`research`), `published_at`. Publishes through `submissions`. The contract obliges at least one per
month, so the portal counts them against the contract period — a reported figure, not an enforced
one.

---

## 5. Member-facing additions

### `member_profiles`

Extends `members` rather than restructuring it, exactly as `005_members.sql` anticipated.

`member_id` (pk, fk), `bio`, `company`, `role_title`, `cities` (text[]), `languages` (text[]),
`interests` (text[]), `can_help_with` (text[]), `looking_for` (text[]), `tier`.

`can_help_with` and `looking_for` are the two fields the design document singles out as the ones
that replace a public social graph, so they are first-class columns.

### `member_field_visibility`

FR-034: a field marked private is **absent from the response**, not hidden in markup.

`member_id` (fk), `field` (text), `visibility` (`public` \| `members` \| `connections` \|
`private`). Primary key `(member_id, field)`.

- The response serializer reads this and omits the field. Because responses are serialized through
  an explicit schema (Principle VI), omission is structural rather than a filter someone can forget
  to apply.

### `connections`

FR-036: no direct message without consent.

`id`, `requester_id`, `addressee_id`, `state` (`requested` \| `accepted` \| `declined` \|
`blocked`), `requested_at`, `responded_at`.

- **Unique** on the unordered pair, so two people cannot hold two mirrored requests.
- **Constraint**: `requester_id <> addressee_id`.
- A message thread between two members requires an `accepted` row. Enforced against the loaded
  target inside the transaction.

### `value_ledger_entries`

FR-035. `id`, `member_id`, `kind` (`saving` \| `resolved_case` \| `introduction` \| `event`),
`amount_cents` (null except for savings), `source_type`, `source_id`, `occurred_at`.

Derived from real events, appended when they happen. The ledger is read as an aggregate; it is
never a stored total, so it cannot drift from the facts it summarises.

---

## 6. Client-side model (no persistence)

| Entity | Shape | Lifetime |
|---|---|---|
| `Session` | principal kind, id, display name | Until sign-out or refusal |
| `CapabilitySet` | `{ kind, modules: { [module]: { read, write, edit, delete, status } } }` for staff; a flat flag list otherwise | Re-fetched on every navigation and after any 403 |
| `NavigationModel` | the sidebar, derived from `CapabilitySet` | Derived, never stored |
| `Problem` | RFC 9457 — `type`, `title`, `status`, `instance` | Per request |
| `DesignToken` | CSS custom property on `@theme` | Build time |

`CapabilitySet` is display input only (FR-004). It is deliberately not cached across a refusal: a
403 means the client's copy is stale, and the correct response is to re-fetch it.

---

## 7. What is deliberately absent

- **No registration, application or approval-of-new-account entity.** FR-002 and FR-037.
- **No CRM entities** — Member 360, Organisation 360, Ask GWC cases, Trust Graph. FR-039.
- **No public-website entities.** FR-038.
- **No membership order or billing entity.** The fee bands are recorded on `organisations` as
  contract facts; charging is not in this feature.
- **No stored aggregate for anything a query can compute** — value ledger totals, merchant
  analytics, partner activation counts. Principle III: published state must match real state, and
  a denormalised copy is how the two diverge.
