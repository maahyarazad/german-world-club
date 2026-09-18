# Implementation Plan: Demo Seed — Every Identity, With Credentials

**Branch**: `005-demo-seed` | **Date**: 2026-09-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-demo-seed/spec.md`

## Summary

Fill a development database with a population worth looking at, covering all four identity kinds,
and print the credentials for each role.

The request assumes four identities exist. Two do not: `organisations`, `organisation_users` and the
merchant and partner token audiences are specified in feature 003's `data-model.md` §1 but were
never built — `AUDIENCES` is still `['public','member','staff']`. So this feature is two things in
order: **build the organisation principals**, then **seed everything**. The schema half follows
003's specification exactly, which means US5 and US6 later build on it rather than around it.

Three findings shaped the design, and each came from running something rather than reading it:

- **A new enum value cannot be used in the transaction that adds it**, and `migrate.js` wraps each
  migration in one. Widening `account_kind` therefore takes two files, not one.
- **Faker's default output is routable.** `internet.email()` returned `Luiz60@hotmail.com`. A
  seeded member with a live address is one misconfigured integration away from sending a stranger a
  password reset.
- **argon2id costs 57 ms a hash.** Five hundred accounts hashed individually is 28 seconds every
  run — enough that people skip the seed. One hash per *password*, reused, makes it milliseconds
  and weakens nothing, because the password is printed on the terminal.

**Scope amended 2026-09-17, on explicit instruction**: offers and events are now in, and the seed
covers every table that holds configuration or domain state. That means building the merchant and
event domains too — four migrations rather than two.

The caution the original plan raised still applies and is answered rather than dropped: *building a
table in order to seed it is how demo data becomes the schema*. Neither of these is invented for the
seeder. Events are specified in `BUSINESS_DESCRIPTION.md` §4 — capacity, a three-phase registration
window, a four-state machine, one registration per member. Offers and redemption are §5. Both are
built to those specifications, so feature 003's US5 and the events module build on them rather than
around them.

**Still out of scope**: the approval-submission machinery (003's US7), corporate entitlements and
vacancies (003's US6 domain). Offers carry their own published state, which is all a demo needs to
see them.

## Technical Context

**Language/Version**: Node 22, ES modules. Server-side only; no client change.

**Primary Dependencies**: `@faker-js/faker`, pinned to an **exact** version. Existing `pg` and
`argon2`.

**Storage**: PostgreSQL. Four new migrations — one widening `account_kind`, one creating the
organisation principals, one the merchant domain (§5), one events (§4).

**Testing**: Vitest. The seed's own suites are DB-backed and skip loudly without a database, like
every other SQL suite here.

**Target Platform**: Development machines only, enforced at runtime.

**Performance Goals**: A full seed in single-digit seconds, and it reports its own elapsed time —
a seed slow enough to skip is a seed nobody runs.

**Constraints**: Nothing generated may be routable. Nothing may touch the six fixed `seed:dev`
accounts. Two runs must produce the same database. Real argon2id parameters, no shortcut.

**Scale/Scope**: ~200 members, 12 staff, 14 organisations with ~25 people, ~60 offers, ~25 events
with several hundred registrations. 24 of 28 tables populated; the other four named and refused.
Hundreds of rows, not millions: this is data to click through, not a load test.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Initial check — before Phase 0

| Principle | Assessment |
|---|---|
| **I. One Rule Set, Three Clients** | **At risk.** A seeder writes straight to the database and can therefore create states the API would refuse — a member whose status never legally transitioned, an organisation with no owner. Seeded data that the running system could not have produced is a trap for whoever debugs against it. |
| **II. Declare Every Posture** | **At risk.** Two new principal kinds mean two new route audiences, and the property that a credential for one audience cannot satisfy another must extend to four kinds rather than quietly hold for two. |
| **III. Published State Must Match Real State** | **Not engaged.** Nothing seeded is published or indexed. |
| **IV. Integrity Lives In The Database** | **At risk, and this is the main one.** A bulk writer is exactly where constraints get worked around: the last-owner guard, the refuse-delete triggers, the status-transition guard. A seeder that disables a trigger to go faster has removed the guarantee for everyone. |
| **V. Failure Is Explicit And Bounded** | **Not engaged.** No request path, no outbound dependency. |
| **VI. The Server Shapes What Leaves It** | **At risk, differently.** The thing leaving here is a credentials table on a terminal. What must never leave is a routable address, and what must never enter is a real person's data. |

**Outcome**: PASS with four principles carrying identified risk. No violation. No entry in
Complexity Tracking.

### Re-check — after Phase 1 design

| Principle | How the design satisfies it | Verified by |
|---|---|---|
| **I** | Every seeded row is a state the API could have produced: statuses are set at insert rather than transitioned through, so the status guard is never contradicted; every organisation gets an owner because the trigger requires one; no row is written that a running server would refuse to create. | SC-002, Scenario 4 |
| **II** | `AUDIENCES` and `TOKEN_AUDIENCES` gain `merchant` and `partner`, with matching entries in `10-auth.js`'s map — the existing mechanism extended, not bypassed. SC-008 asserts all four kinds against each other's routes, which is twelve refusals rather than the two that hold today. | SC-008 |
| **III** | Offers and events carry published state, and a seeded offer's visibility depends on its own dates AND its organisation's status — so a suspended merchant's published offer is still invisible, which is the rule §5's lapsed-contract clause exists for. No seeded row advertises availability it does not have. | SC-011 |
| **IV** | **No trigger is disabled anywhere.** There is no delete path at all: idempotency is `ON CONFLICT DO NOTHING`, so the refuse-delete triggers never need working around. The last-active-owner guard is honoured by construction. `organisations` carries its own refuse-delete trigger, matching `members`. The new domain constraints are real ones the seeder must satisfy rather than bypass: `member_price < regular_price`, one registration per member per event, capacity enforced — each asserted by trying to violate it. | Scenario 4 step 8, SC-004, SC-012, SC-013 |
| **V** | Unchanged. | — |
| **VI** | Every generated email ends in `.invalid` (RFC 2606, unresolvable in any DNS); every mobile is in Ofcom's drama range. Faker's own defaults are overridden precisely because they are routable. The credentials file is gitignored in the same change that creates it. **And the four token tables are never written**: a seeded session is a valid credential nobody authenticated for, which is a security hazard rather than a purity concern. | SC-005, SC-015 |

**Outcome**: PASS. The Principle IV risk — the one a bulk writer really carries — is answered by
having no destructive path in the command at all, rather than by promising to use one carefully.
Complexity Tracking remains empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-demo-seed/
├── plan.md              # This file
├── spec.md              # 5 user stories, 36 FRs, 15 success criteria
├── research.md          # Phase 0 — 10 decisions, 3 open questions
├── data-model.md        # Phase 1 — 4 migrations, the generated population
├── quickstart.md        # Phase 1 — 7 runnable scenarios
├── contracts/
│   ├── credentials.md   # The table, and why it is the deliverable
│   └── seed-command.md  # Flags, guarantees, and what it refuses to do
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source code (repository root)

```text
packages/contracts/src/
└── permissions.js                         # + merchant, partner in both audience lists

server/
├── migrations/
│   ├── 013_organisation_principals.sql    # NEW — widens account_kind, and NOTHING else
│   ├── 014_organisations.sql              # NEW — organisations, organisation_users, triggers
│   ├── 015_merchant_domain.sql            # NEW — merchant_locations, offers, redemptions, feedback (§5)
│   └── 016_events.sql                     # NEW — events, event_registrations (§4)
├── src/
│   ├── plugins/10-auth.js                 # + merchant, partner in TOKEN_AUDIENCE
│   └── scripts/
│       ├── seed-dev.js                    # UNCHANGED — the six fixed accounts stay as they are
│       └── seed-demo.js                   # NEW — the command
│   └── seed/
│       ├── faker.js                       # NEW — seeded instance, safe email and phone
│       ├── hashing.js                     # NEW — one argon2 hash per password, reused
│       ├── members.js                     # NEW — the state distribution
│       ├── staff.js                       # NEW — varied permission matrices
│       ├── organisations.js               # NEW — merchants and partners with their people
│       ├── offers.js                      # NEW — locations, offers, redemptions, feedback
│       ├── events.js                      # NEW — events across the state machine, registrations
│       ├── content.js                     # NEW — assets, variants, SEO metadata, redirects
│       ├── operations.js                  # NEW — push, jobs, devices, and consistent history
│       ├── tables.js                      # NEW — the seed/do-not-seed manifest, one place
│       └── credentials.js                 # NEW — the roles, and the printed table
└── tests/seed/
    ├── credentials.test.js                # NEW — every printed row signs in
    ├── coverage.test.js                   # NEW — every state present, population not uniform
    ├── determinism.test.js                # NEW — two runs identical; --random differs
    ├── safety.test.js                     # NEW — nothing routable, gate refuses, fixed accounts intact
    ├── audiences.test.js                  # NEW — four kinds, twelve refusals
    ├── content.test.js                    # NEW — offer and event states, DB constraints hold
    └── table-manifest.test.js             # NEW — every table seeded or on the named exclusion list

.gitignore                                 # + server/.seed-credentials.md
```

**Structure Decision**: The generation logic lives in `server/src/seed/` as small modules rather
than one long script, because the credentials suite needs to import the role list and assert
against it — a script that only printed its table would leave SC-001 checking a copy of the truth
rather than the truth.

## Delivery order

| # | Slice | Delivers | Blocked on |
|---|---|---|---|
| 1 | **Organisation principals** | Migrations 013–014, four audiences, merchant and partner able to exist and sign in | — |
| 2 | **Seed foundations** | Pinned Faker, the seeded instance, safe email and phone, the development gate, the table manifest | — |
| 3 | **Members and staff** | The state distribution and the varied permission matrices — the half that works against today's schema | 2 |
| 4 | **Organisations** | Merchants, partners and their people | 1, 2 |
| 5 | **The credentials table** | The printed and written output, and the suite that drives every row through sign-in | 3, 4 |
| 6 | **Merchant domain** | Migration 015, then locations, offers across their lifecycle, redemptions and feedback | 4 |
| 7 | **Events** | Migration 016, then events across the state machine with registrations and a full one | 3 |
| 8 | **Everything else** | Content, operations, and the consistent-history rule applied to the audit log | 3 |

Slices 1 and 2 are independent. Slice 3 alone is already useful: a populated member and staff
console. Slices 6 and 7 are independent of each other.

## Risks

| Risk | Consequence | Mitigation |
|---|---|---|
| A generated address is routable | A stranger receives a password reset for an account they never had | `.invalid` enforced and asserted; Faker's defaults never used raw |
| The seed is run against a shared database | Published credentials on a real system | `NODE_ENV === 'development'` exactly, exit 1 otherwise, asserted for `test` and `production` |
| A trigger is disabled to make the seed work | A guarantee removed for everyone, not just the seeder | No delete path exists; idempotency is a conflict clause |
| Faker is upgraded | Every generated name changes; determinism breaks with no code change | Exact version pin, called out as load-bearing rather than hygiene |
| Seeded rows the API could not have produced | Hours lost debugging a state the running system cannot reach | States set at insert, never transitioned; every organisation gets an owner |
| The seed collides with the fixed accounts | The suites and quickstart scenarios break | Separate email namespaces; additive only; SC-007 compares all six before and after |
| Hashing at real cost makes it slow | People stop running it | One hash per password, reused; elapsed time reported |
| A suite depends on demo data | The tests start failing when volumes change | No suite uses it; the fixed accounts remain the fixtures |
| Fabricated audit history | The one table nobody may edit becomes the one full of fiction | Audit entries only where a seeded fact implies one, at that fact's own timestamp |
| A seeded session | A valid credential exists that nobody authenticated for | Four token tables are on a named do-not-seed list, asserted |
| "All the tables" drifts to "most" | A table is added later and quietly never seeded | One manifest; a test enumerates the live schema against it |
| Domain tables built to suit the seeder | Demo data becomes the schema | Events from §4, offers from §5, built to the business description rather than to the generator |

## Open questions

Carried from research, none blocking Phase 2. **All three resolved at T064**; the decisions and
what settled them are recorded below rather than left open.

1. **Organisation people's email namespace** — *Resolved: their own subdomains.*
   `merchant.demo.invalid` and `partner.demo.invalid`, alongside `demo.invalid` for members and
   `staff.demo.invalid` for staff (`EMAIL_DOMAIN` in `src/seed/faker.js`). Two reasons, and the
   second is the load-bearing one: an address says what it is at a glance, and
   `organisation_users.email` is unique *per organisation* rather than globally, so the same
   generated local part can legitimately appear twice. Keeping each kind in its own subdomain means
   reading a credential out of the printed table can never land on the wrong identity kind.

2. **A `--reset` path** — *Resolved: never. Not deferred, declined.*
   `members` and `organisations` both refuse `DELETE` by trigger, deliberately: ending a membership
   or a commercial relationship is a status transition that preserves history. The only working
   implementation of `--reset` disables those triggers, and a command that disables them is one
   tab-completion away from the wrong database. The seed is additive and idempotent instead — a
   second run adds nothing (proved by `tests/seed/credentials.test.js`), and a database somebody
   genuinely wants empty is a `dropdb`, which is explicit about what it destroys. Idempotency is the
   seeder's problem and it is solved in the seeder, not by giving it a delete path.

3. **Ofcom's drama range on German members** — *Resolved: keep it, and say why in the code.*
   A `+44 7700 900…` number on a member living in Dubai reads oddly. It is the only reserved mobile
   range available: the German numbering plan has no equivalent, and "currently unassigned" is not
   "will never be assigned". Verisimilitude is the whole of what is lost; what would be risked
   instead is a real handset receiving a real one-time code from a demo database pointed at a live
   SMS provider. The comment in `safeMobile()` states the trade so the next person does not
   re-litigate it by replacing the number with a German-looking one.

Worth flagging beyond this feature: building slice 1 **unblocked feature 003's US5 and US6**, which
had been waiting on exactly these two tables — and in the event on rather more, since seeding offers
and events required building their tables too (migrations 015 and 016). 003's T068, T070 and T101
are marked delivered there, and its Phase 7 now records the unblock.

## Complexity Tracking

No Constitution violations. Table intentionally empty.
