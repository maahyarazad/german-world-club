# Phase 0 Research: Demo Seed

**Feature**: 005-demo-seed | **Date**: 2026-09-17

Every decision below was taken against the schema as it stands, and the three that matter most —
R2, R4 and R6 — came from running the thing rather than reading about it.

---

## R1. Two of the four identities have to be built first

**Decision**: Add `organisations` and `organisation_users` per feature 003's `data-model.md` §1,
and widen the principal model to four kinds, before seeding anything.

`packages/contracts/src/permissions.js` still declares `AUDIENCES = ['public','member','staff']`
and `TOKEN_AUDIENCES = ['member','admin']`. Feature 003's T068, T070 and T101 are all open. There
is no merchant principal and no partner principal anywhere in the codebase — not a table, not an
audience, not a route.

So "seed merchants and partners" is not a seeding task at the point it is asked. Half of it is
schema work.

**Rationale**: The alternative — a cut-down organisations table that exists only to hold a login —
would have to be migrated again the moment 003's US5 lands, and a throwaway schema for demo data is
how demo data becomes the schema. Following 003's specification means this feature's migration is
the one US5 and US6 build on.

**Scope discipline**: the *principal* half of 003 Phase 7 only. `offers`, `redemptions`,
`employee_entitlements`, `vacancies` and the submission machinery stay unbuilt — they are US5/US6
work and nothing in the credentials table needs them.

---

## R2. Widening `account_kind` needs two migrations, not one

**Decision**: `013_organisation_principals.sql` widens the enum; `014_organisations.sql` creates
the tables that use it.

`account_kind` is `ENUM ('member','admin')` and it is the join key for `sessions`,
`refresh_tokens`, `password_reset_tokens` and `otp_challenges` — one table each, keyed by
`(account_id, account_kind)`, which is what lets one session mechanism serve every principal.
Adding merchant and partner principals means widening it.

**The constraint, confirmed by running it**:

```
BEGIN; ALTER TYPE zz ADD VALUE 'b'; INSERT INTO t VALUES ('b'); ROLLBACK;
ERROR:  unsafe use of new value "b" of enum type zz
HINT:   New enum values must be committed before they can be used.
```

`server/src/db/migrate.js:49` wraps each migration file in one transaction — deliberately, so a
partial apply cannot leave the schema half-built. That is correct and should not change. It does
mean a single file cannot both add an enum value and use it.

**Rationale**: Two files is the smaller accommodation. The alternative is special-casing one
migration to run outside a transaction, which trades a permanent hole in the "each migration is
atomic" guarantee for one file's convenience.

**Alternatives considered**:

- *A separate `organisation_sessions` table.* Rejected — it would duplicate session uniqueness, the
  denylist and the revocation window, each of which is already correct once. 003's R4 is explicit
  that organisation principals go "over the existing session and refresh machinery rather than
  beside it".
- *A text column instead of an enum.* Rejected — the enum is what makes an impossible
  `account_kind` unrepresentable, and dropping it to avoid a migration ordering issue is a bad
  trade.

---

## R3. Faker: version-pinned, seeded, German-first

**Decision**: `@faker-js/faker` at a pinned exact version, constructed with `new Faker({ locale:
[de, en] })`, seeded from a constant.

**Determinism confirmed**:

```js
f.seed(42); f.person.fullName()  // → 'Melinda Dragu'
f.seed(42); f.person.fullName()  // → 'Melinda Dragu'
```

**Pinned exactly, not by range.** Faker's output for a given seed is not stable across versions —
new locale data shifts every subsequent draw. A caret range would silently change every generated
name on the next `npm install`, which breaks FR-017 without touching a line of this feature's code.
The pin is a load-bearing part of the determinism claim, not hygiene.

**`setDefaultRefDate`** is set to a constant as well. Anything relative — "joined 8 months ago" —
otherwise moves with the wall clock and the second run differs from the first.

**Locale `[de, en]`**: German first, English as fallback for anything the German locale lacks. This
matches the club: German-speaking members with international lives, per the design document. Not
`de` alone — a locale array is how Faker fills the gaps, and an exclusively German population would
misrepresent a club whose whole premise is people living abroad.

---

## R4. Faker's default output is routable, and that is a hazard

**Decision**: Override the email domain and generate phone numbers from a reserved range. Never use
`internet.email()` or `phone.number()` unmodified.

**Observed**:

```
f.internet.email()                             → Luiz60@hotmail.com     ← a real domain
f.internet.email({ provider: 'test.invalid' }) → Luka.Erm@test.invalid  ← safe
f.phone.number()                               → (0612) 347155061       ← looks dialable
```

A seeded member with a `hotmail.com` address is one misconfigured mail integration away from
sending a real person a password reset for an account they have never heard of. The platform's mail
and SMS integrations are stubbed in development — but "the integration is stubbed" is a property of
today's configuration, not a control.

**Emails**: `.invalid` is reserved by RFC 2606 and can never resolve, in any DNS, ever. The existing
test fixtures already use `@test.invalid`, so this is the established convention rather than a new
one.

**Phone numbers**: there is no reserved mobile range in the German numbering plan. The nearest thing
to a guarantee is Ofcom's drama range, `+44 7700 900000`–`900999`, reserved specifically so fiction
cannot dial a real handset. A British number on a German member reads slightly oddly; a real handset
receiving a real OTP reads much worse. Safety wins, and the oddity is documented at the call site.

**Alternatives considered**: `example.com` — reserved by the same RFC and equally safe, but
`.invalid` says what it is at a glance and matches the fixtures. A plausible-but-unassigned German
prefix — rejected, "currently unassigned" is not "will never be assigned".

---

## R5. Hash once per password, not once per account

**Decision**: Compute one argon2id hash per distinct password and reuse the string across every
account that shares it.

**Measured**: 57 ms per hash at the configured cost (argon2id, 19 MiB, t=2). Five hundred accounts
hashed individually is roughly 28 seconds of pure CPU, every run — enough that people start
skipping the seed.

An argon2 hash is self-contained: the PHC string carries its own salt and parameters. Reusing one
hash across many rows means those accounts genuinely share one password, which is exactly what a
published demo credential is. Nothing is weakened, because there was nothing to weaken: the
password is printed on the terminal.

**Rationale, and the line not crossed**: FR-016 keeps the real hashing. It would be faster still to
drop the cost parameters for seeding, and that is the tempting shortcut — but then sign-in latency
under seeded data stops resembling production, and the one place a slow hash actually matters
becomes the one place nobody measures it.

**Consequence**: accounts sharing a role share a password by construction, which is what makes the
credentials table short enough to read.

---

## R6. The six fixed accounts are not ours to touch

**Decision**: Additive only. A separate `seed:demo` command; `seed:dev` unchanged.

`seed:dev` creates `seo@`, `reader@`, `push@`, `nogrants@`, `super@` and `member@test.invalid`.
Those are load-bearing: the quickstart scenarios name them and the DB-backed suites create
equivalents. `nogrants@` in particular is the counter-assertion for the entire capability
mechanism.

Generated identities therefore live in a namespace that cannot collide: a distinct email domain for
demo data, so a generated address can never shadow a fixed one even if Faker produced the same
local part.

**No delete path.** `members` refuses `DELETE` by trigger (§12.4) and the test helper only gets
around it by disabling the trigger — which is defensible inside a suite that immediately re-enables
it, and not defensible in a command someone runs by hand. Idempotency comes from `ON CONFLICT (email)
DO NOTHING` instead, which also satisfies FR-019 without any destructive path existing at all.

**Alternatives considered**: a `--reset` flag. Rejected for now — the only safe implementation
disables a trigger that exists to make member deletion impossible, and a flag that does that is one
tab-completion away from being run against the wrong database.

---

## R7. The development gate

**Decision**: Refuse unless `NODE_ENV === 'development'`, exactly, and exit non-zero with the
reason.

This copies `seed-dev.js` rather than inventing something: `development` exactly, not
`!isProduction`, because staging runs as production and a CI database is not a place for published
credentials either.

**Rationale**: everything this command writes has a password printed on a terminal. "We would never
run it in production" is not a control; the gate is.

---

## R8. What the population has to contain to be worth having

**Decision**: Spread deliberately across every state the product models, rather than generating
uniform rows and hoping variety emerges.

Uniform data hides exactly what a demo is for. Concretely, from the schema:

| Column | Values that must appear |
|---|---|
| `members.status` | `active`, `locked`, `inactive`, `ended` — all four |
| `members.email_confirmed_at` | null and set |
| `members.mobile_verified_at` | null and set, and members with no mobile at all |
| `members.password_hash` | argon2, a legacy MD5 (forces reset), and null (no usable password) |
| `members.email_suppressed` / `email_bounce_count` | suppressed after ≥5 bounces, and clean |
| `members.inactivity_exempt` | the §3.2 "hidden" members |
| `members.permissions` | `marketplace_post` and `thread_moderate` in both states |
| `admin_permissions` | single-module, several-module, and superadmin |

**Rationale**: A member list where every row is `active` proves nothing about how the other three
render. An all-superadmin staff list proves nothing about the permission matrix the platform is
built on. These are the states a reviewer needs to *see* to judge the console.

---

## R9. The credentials table is the deliverable

**Decision**: Print role, description, email and password as a table on stdout at the end of the
run, and write the same table to a gitignored file.

The request is "I need the passwords for each role", so the table is not a convenience — it is what
the feature produces. Everything else is the data behind it.

**Per role, not per account.** Hundreds of accounts share a handful of passwords (R5), so the table
has roughly a dozen rows and stays readable. Each row names one representative account.

**Also written to a file** because a terminal scrolls, and the seed prints a summary after it. The
file is gitignored — publishing credentials in a terminal is the point; committing them is not.

---

## R10. Volume

**Decision**: Defaults sized for looking at, adjustable by flag.

| | Default | Why |
|---|---|---|
| Members | 200 | Enough to paginate and to spread across four statuses and several credential states |
| Staff | 12 | One per interesting grant shape, plus a few ordinary ones |
| Merchant organisations | 8 | Enough for a list; each with 1–3 people |
| Partner organisations | 6 | As above |

Hundreds, not millions: this is data to click through, not a load test. `--members=N` and the rest
adjust it (FR-021), and the totals are reported so a run that silently did nothing is visible
(FR-022).

---

## Unresolved

| # | Question | Blocking? | Carried as |
|---|---|---|---|
| 1 | Should organisation people share the member email namespace or have their own? | No — a separate namespace is assumed, which also makes their role obvious in a list | Phase 1 |
| 2 | Do we want a `--reset` path eventually, and if so with what safeguard? | No — additive-only is sufficient for FR-019 | R6 |
| 3 | German phone numbers would read better than the Ofcom drama range. Is there a reserved German range worth using instead? | No — safety is not in question, only verisimilitude | R4 |
