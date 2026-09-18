# Phase 1 Data Model: Demo Seed

**Feature**: 005-demo-seed | **Date**: 2026-09-17

Two migrations of real schema, and a generated population that exists only on development machines.

---

## 1. Schema added

### `013_organisation_principals.sql` — widen the enum, alone

```sql
ALTER TYPE account_kind ADD VALUE IF NOT EXISTS 'merchant';
ALTER TYPE account_kind ADD VALUE IF NOT EXISTS 'partner';
```

**Nothing else may go in this file.** A new enum value cannot be used in the transaction that adds
it, and `migrate.js` wraps each file in exactly one transaction — deliberately, so a partial apply
cannot leave the schema half-built. Verified:

```
ERROR:  unsafe use of new value "b" of enum type zz
HINT:   New enum values must be committed before they can be used.
```

Widening `account_kind` is what lets organisation principals reuse `sessions`, `refresh_tokens`,
`password_reset_tokens` and `otp_challenges` unchanged. Each of those keys on
`(account_id, account_kind)` with no foreign key, precisely so one session mechanism can serve every
kind of principal (see the comment at `007_sessions_and_refresh_tokens.sql:6`).

### `014_organisations.sql` — the tables

Per feature 003's `data-model.md` §1, so US5 and US6 build on this rather than around it.

#### `organisations`

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `kind` | `organisation_kind` not null | `merchant` \| `partner`. Fixed at creation — a merchant never becomes a partner |
| `legal_name` | text not null | |
| `slug` | citext unique not null | Public URLs are slug-based (Principle III) |
| `status` | `organisation_status` not null | `pending` \| `active` \| `suspended` \| `ended`. Only `active` may publish |
| `status_changed_at` | timestamptz not null | |
| `contract_start` / `contract_end` | date | A lapsed contract must not leave content published |
| `fee_tier` | text | The banded fee from the design document. Recorded, never computed by a client |
| `location_count` / `employee_count` | integer | Drives the fee band. Merchant uses locations, partner uses employees |
| `created_at` / `updated_at` | timestamptz not null | |

- **Constraint**: `location_count` is null for a partner; `employee_count` is null for a merchant.
  The two fee bands are different questions and a row must not answer both.
- **Constraint**: `contract_end >= contract_start`.
- **Unique** `(id, kind)` — redundant against the primary key, and it exists so later tables can
  carry a composite foreign key that makes attaching an entitlement to a *merchant* impossible.
  003's `employee_entitlements` depends on this index existing.
- **Refuses DELETE**, by trigger, like `members`. Ending a commercial relationship is a status
  transition that preserves history, and the prohibition belongs in the database so it survives an
  ad-hoc query (Principle IV).

#### `organisation_users`

The merchant and partner principals.

| Field | Type | Rules |
|---|---|---|
| `id` | uuid pk | |
| `organisation_id` | uuid fk → `organisations` not null | |
| `email` | citext not null | Unique **per organisation**, not globally — the same person may act for two |
| `password_hash` | text | Null means no usable password; sign-in is refused rather than falling back |
| `role` | `organisation_role` not null | `owner` \| `manager` \| `staff`. Scopes what they may do *within* their own organisation only |
| `status` | `member_status` not null | Reuses the existing enum; only `active` may sign in |
| `display_name` | text | |
| `last_login_at` | timestamptz | |

- **Unique** `(organisation_id, email)`.
- **Trigger**: an organisation always retains at least one active `owner`, mirroring the
  last-superadmin guard on `admin_users`. An organisation nobody can administer is a support ticket
  the database can refuse to create.
- **Scoping invariant**: every query an organisation principal makes is filtered by its
  `organisation_id`. A route-level audience cannot express "yours", so this is an object guard
  enforced against the loaded target inside the transaction (Principle II).

#### Contract change

`packages/contracts/src/permissions.js`:

```js
AUDIENCES       = ['public', 'member', 'staff', 'merchant', 'partner']
TOKEN_AUDIENCES = ['member', 'admin', 'merchant', 'partner']
```

and the matching entries in `10-auth.js`'s `TOKEN_AUDIENCE` map, so a credential for one audience
still cannot satisfy a route for another — the property that already holds for member and staff,
extended rather than weakened.

### Explicitly not built here

`offers`, `redemptions`, `redemption_feedback`, `merchant_locations`, `employee_entitlements`,
`vacancies`, `partner_articles`, `submissions`. They are feature 003's US5 and US6, nothing in the
credentials table needs them, and building a table to seed it is how demo data becomes the schema.

---

## 2. The generated population

Nothing below is a new table. It is what the seed puts into existing ones.

### Namespaces

Generated identities live at domains that cannot collide with the six fixed `seed:dev` accounts:

| Kind | Domain | Example |
|---|---|---|
| Fixed (`seed:dev`) | `@test.invalid` | `seo@test.invalid` — **untouched by this feature** |
| Generated member | `@demo.invalid` | `anna.mueller@demo.invalid` |
| Generated staff | `@staff.demo.invalid` | `k.schmidt@staff.demo.invalid` |
| Generated merchant person | `@merchant.demo.invalid` | `inhaber@alpine-hiking.merchant.demo.invalid` |
| Generated partner person | `@partner.demo.invalid` | `hr@siemens-ch.partner.demo.invalid` |

`.invalid` is reserved by RFC 2606 and can never resolve in any DNS. Separate subdomains per kind
mean a glance at an address says what it is, and a generated address can never shadow a fixed one
even if Faker produced the same local part.

### Members — spread across every state (FR-007 … FR-009)

Roughly 200 by default, deliberately distributed rather than uniform:

| Slice | Share | What it exercises |
|---|---|---|
| `active`, confirmed, mobile verified | ~55% | The ordinary case |
| `active`, email unconfirmed | ~8% | `profile_incomplete` at sign-in |
| `active`, no mobile | ~10% | Members the OTP path cannot reach |
| `locked` | ~7% | `ACCOUNT_LOCKED` refusal |
| `inactive` | ~7% | `ACCOUNT_INACTIVE`, and reactivation by reset |
| `ended` | ~5% | `MEMBERSHIP_ENDED` |
| legacy MD5 hash | ~4% | `password_reset_required` — a 200 carrying no session |
| `password_hash` null | ~2% | No usable credential at all |
| suppressed, `email_bounce_count >= 5` | ~4% | §8 bounce handling and §9 bulk suppression |
| `inactivity_exempt` | ~5% (overlaid) | §3.2 hidden members |
| `permissions` flags set | ~15% (overlaid) | `marketplace_post`, `thread_moderate` |

The percentages are a distribution, not a promise: SC-002 asserts **presence** of every state, not
a ratio, because a ratio would make the check brittle for no gain.

### Staff — varied partial matrices (FR-010)

About 12, no two with the same matrix:

- one superadmin,
- one holding a single module,
- several holding two to five modules with mixed flags — `read` alone, `read + edit`, `read +
  status`,
- at least one `is_active = false`,
- at least one holding only modules the server cannot yet serve, so the "noch nicht verfügbar"
  path has a real account behind it.

### Organisations

8 merchants and 6 partners by default. Each carries a plausible fee band from the design document
(merchants by location count, partners by employee count), a status — mostly `active`, with at
least one `pending` and one `suspended` — and one to three people, of whom exactly one is an
`owner`.

---

## 3. The credentials table

What the command produces, and the reason the rest exists.

| Field | Example |
|---|---|
| Kind | `staff` |
| Role | `SEO only` |
| What it can do | "Reads and edits SEO metadata; nothing else" |
| Email | `seo.demo@staff.demo.invalid` |
| Password | `demo-seo` |

One row per role, not per account: hundreds of accounts share about a dozen passwords, because one
argon2 hash is computed per password and reused (research R5). That is what keeps the table short
enough to read.

Printed to stdout and written to `server/.seed-credentials.md`, which is gitignored. A terminal
scrolls; publishing credentials there is the point, committing them is not.

---

## 4. Determinism

| Input | Value |
|---|---|
| Faker seed | a constant in the source |
| `setDefaultRefDate` | a fixed ISO date |
| Faker version | pinned **exactly**, not by range |
| Locale | `[de, en]` — German first, English fallback |

The version pin is load-bearing rather than hygienic: Faker's output for a given seed shifts between
versions as locale data changes, so a caret range would silently change every generated name on the
next install and break FR-017 without touching this feature's code.

`--random` opts out and says so in its output, so a run with varying data cannot be mistaken for a
reproducible one.

---

## 5. Deliberately absent

- **No delete path.** `members` refuses `DELETE` by trigger; idempotency is `ON CONFLICT (email) DO
  NOTHING`. A command that disables that trigger is one tab-completion from the wrong database.
- **No production or staging reachability.** The command exits non-zero unless `NODE_ENV` is exactly
  `development`.
- **No plaintext password column.** Passwords exist in the printed table and in argon2 hashes, and
  nowhere else.
- **No change to `seed:dev`** or to any account it creates.
