---

description: "Task list for 005-demo-seed"
---

# Tasks: Demo Seed — Every Identity, With Credentials

**Input**: Design documents from `/specs/005-demo-seed/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Included. SC-001 through SC-015 are each stated as an automated check, and the
constitution makes "every principle is verifiable" a gate. Per the repository's convention each gate
names its counter-assertion — here the specific danger is a suite that proves the seed *ran*, which
would pass against a seed that inserted one row.

**Scope amended 2026-09-17**: offers, events and "all the tables" were added after the plan was
written. `spec.md` and `plan.md` were amended first, so this list does not contradict its own
specification. Four migrations rather than two.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 credentials · US2 state coverage · US3 determinism · US4 organisation principals · US5 content
- Exact file paths are given in every task

## Path Conventions

Existing workspaces: `server/`, `packages/contracts/`. No client change. No new workspace.

---

## Phase 1: Setup

**Purpose**: The generator, made safe and reproducible before anything uses it.

- [X] T001 Add `@faker-js/faker` to `server/package.json` at an **exact** version, not a caret range — Faker's output for a given seed shifts between versions, so a range would silently break determinism on the next install without touching this feature's code
- [X] T002 Create `server/src/seed/faker.js` exporting a `Faker` built with `locale: [de, en]`, a constant `faker.seed(...)` and a constant `setDefaultRefDate(...)` — German first with English fallback, matching a club of German speakers living abroad
- [X] T003 Add `safeEmail(localPart, subdomain)` to `server/src/seed/faker.js` forcing every address to `.invalid` (RFC 2606, unresolvable in any DNS). Faker's own `internet.email()` returns live domains — `Luiz60@hotmail.com` was the first thing it produced — and must never be used raw
- [X] T004 Add `safeMobile()` to `server/src/seed/faker.js` drawing from Ofcom's drama range `+447700900000`–`900999`, reserved so fiction cannot dial a real handset. Note at the call site that a British number on a German member reads oddly, and that a real handset receiving a real OTP reads much worse
- [X] T005 [P] Create `server/src/seed/tables.js`: the single manifest naming every table as `seed` or `never`, with the reason for each exclusion. `sessions`, `refresh_tokens`, `otp_challenges` and `password_reset_tokens` are `never` — they hold live credentials created by signing in
- [X] T006 [P] Create `server/tests/seed/table-manifest.test.js` comparing the manifest against the live schema via `information_schema.tables`: every table is on it, exactly once — so a table added later cannot quietly go unseeded (SC-014)
- [X] T007 [P] Add `server/.seed-credentials.md` to `.gitignore` **in the same change that creates the writer** — a file written before it is ignored is a file that gets committed once

---

## Phase 2: Foundational — the command shell

**Purpose**: The safety gate and the runner, before there is anything to seed.

**⚠️ Blocks every story.**

- [X] T008 Create `server/src/scripts/seed-demo.js` with the development gate: exit 1 unless `NODE_ENV` is exactly `development`, printing why. `development` exactly, not `!isProduction` — staging runs as production and a CI database is no place for published credentials
- [X] T009 Wire `seed:demo` in `server/package.json`, leaving `seed:dev` untouched
- [X] T010 Add flag parsing to `server/src/scripts/seed-demo.js` for `--members`, `--staff`, `--merchants`, `--partners`, `--offers`, `--events`, `--random` and `--quiet`, with the defaults from `research.md` R10
- [X] T011 Add the migration precondition to `server/src/scripts/seed-demo.js`: fail with a clear message if the database is not migrated to at least 016, rather than producing a partial population and a confusing error
- [X] T012 Create `server/src/seed/hashing.js` computing **one argon2id hash per distinct password** and reusing it across every account that shares it — 57 ms a hash means 500 accounts is 28 seconds a run, which is how a seed becomes one nobody runs. Keep the platform's real cost parameters; lowering them would make sign-in latency under seeded data stop resembling production
- [X] T013 [P] Create `server/tests/seed/safety.test.js` asserting the gate refuses under `test` and `production` and permits `development` — with the counter-assertion that it permits development, so the test cannot pass against a command that refuses everything (SC-006)

---

## Phase 3: User Story 4 - Organisation principals exist (Priority: P1)

**Goal**: Merchant and partner principals exist, can sign in, and reach only their own organisation.

**Independent Test**: Sign in as a merchant and as a partner; confirm each reaches its own area and
neither reaches the other's or the admin console.

**Ordered first among the stories** because two of the four identity kinds do not exist, and the
credentials table cannot be produced without them.

### Tests for User Story 4

- [X] T014 [P] [US4] Create `server/tests/seed/audiences.test.js`: all four principal kinds against each other's routes — twelve refusals, not the two that hold today. Counter-assertion: each kind reaches its **own** route, so the suite cannot pass against a server that refuses everyone
- [X] T015 [P] [US4] Add to `server/tests/seed/audiences.test.js` the organisation-scoping assertion: a merchant principal reading another organisation's row is refused identically to reading one that does not exist (FR-012, SC-009)
- [X] T016 [P] [US4] Create `server/tests/seed/organisation-constraints.test.js`: the last-active-owner trigger refuses removing the only owner; `DELETE FROM organisations` is refused; a partner row with `location_count` is refused; `contract_end < contract_start` is refused

### Implementation for User Story 4

- [X] T017 [US4] Create `server/migrations/013_organisation_principals.sql` adding `merchant` and `partner` to `account_kind`, **and nothing else** — a new enum value cannot be used in the transaction that adds it, and `migrate.js` wraps each file in one (verified: `unsafe use of new value`)
- [X] T018 [US4] Create `server/migrations/014_organisations.sql` with `organisations` and `organisation_users` per `data-model.md` §1: the `organisation_kind`/`organisation_status`/`organisation_role` enums, the kind-vs-count constraint, the `(id, kind)` unique index later tables need for composite foreign keys, the last-active-owner trigger and the refuse-delete trigger
- [X] T019 [US4] Add `merchant` and `partner` to `AUDIENCES` and `TOKEN_AUDIENCES` in `packages/contracts/src/permissions.js`
- [X] T020 [US4] Add both to the `TOKEN_AUDIENCE` map in `server/src/plugins/10-auth.js`, so a credential for one audience still cannot satisfy a route for another — the existing mechanism extended, not bypassed
- [X] T021 [US4] Extend account lookup and sign-in in `server/src/auth/routes.js` to resolve `organisation_users`, over the existing session and refresh machinery rather than beside it
- [X] T022 [US4] Add the organisation-scoping object guard to `server/src/authz/object-guards.js`, enforced against the loaded target inside the transaction — a route-level audience cannot express "yours"
- [X] T023 [US4] Add the four new routes' rows to `server/tests/authz/matrix.test.js`, which will otherwise fail the coverage assertion

**Checkpoint**: Four principal kinds exist and are isolated from each other.

---

## Phase 4: User Story 2 - The population covers every state (Priority: P1)

**Goal**: Members across every status and credential state; staff with varied partial matrices.

**Independent Test**: Query the seeded population and confirm every state is represented and no two
staff matrices are alike.

### Tests for User Story 2

- [X] T024 [P] [US2] Create `server/tests/seed/coverage.test.js` asserting every `member_status` value is present among seeded members, plus unconfirmed email, verified and unverified mobile, suppressed addresses and `inactivity_exempt` (SC-002)
- [X] T025 [P] [US2] Add to `server/tests/seed/coverage.test.js` the credential-state assertions: at least one legacy MD5 hash, at least one null `password_hash`, and the rest argon2
- [X] T026 [P] [US2] Add the staff-matrix assertions to `server/tests/seed/coverage.test.js`: no two matrices identical, at least one single-module account, at least one superadmin, at least one inactive — with the counter-assertion that the population is **not uniform**, which is what a suite checking only "rows exist" would miss

### Implementation for User Story 2

- [X] T027 [US2] Create `server/src/seed/members.js` generating the distribution in `data-model.md` §2, setting statuses **at insert** rather than transitioning through them so the status-transition guard is never contradicted
- [X] T028 [US2] Give seeded members their own email namespace (`@demo.invalid`) in `server/src/seed/members.js`, so a generated address can never shadow one of the six fixed `seed:dev` accounts even on a local-part collision
- [X] T029 [US2] Make member insertion idempotent in `server/src/seed/members.js` with `ON CONFLICT (email) DO NOTHING` — **not** a delete path: `members` refuses `DELETE` by trigger, and a command that disables that trigger is one tab-completion from the wrong database
- [X] T030 [US2] Create `server/src/seed/staff.js` generating varied partial permission matrices, including one account holding only modules the server cannot serve yet — so the console's "noch nicht verfügbar" path has a real account behind it

**Checkpoint**: A populated member and staff console. Useful on its own, without organisations.

---

## Phase 5: User Story 1 - Credentials for every role (Priority: P1) 🎯 MVP

**Goal**: One command prints a table of role → email → password, and every row behaves as stated.

**Independent Test**: Run the seed, take any row, sign in.

### Tests for User Story 1

- [X] T031 [P] [US1] Create `server/tests/seed/credentials.test.js` driving **every row the seed produced** through `POST /auth/sign-in` — imported from `server/src/seed/credentials.js`, not a copy, so a row that stops working fails rather than a duplicate of the truth (SC-001)
- [X] T032 [P] [US1] Add to `server/tests/seed/credentials.test.js` the non-authenticating rows: `(reset required)` yields `password_reset_required`, `(locked)` yields the status refusal, `(no usable password)` is refused — those are the interesting accounts and the table would be lying if it omitted them
- [X] T033 [P] [US1] Add the idempotency assertions to `server/tests/seed/credentials.test.js`: a second run adds zero rows and prints the same table, with the counter-assertion that the first run added more than zero (SC-004)

### Implementation for User Story 1

- [X] T034 [US1] Create `server/src/seed/credentials.js` defining the roles from `contracts/credentials.md` — one row per role, not per account, since hundreds of accounts share about a dozen passwords
- [X] T035 [US1] Render the credentials table to stdout in `server/src/seed/credentials.js`, with `(reset required)` and friends in the password column where a row is not meant to authenticate
- [X] T036 [US1] Write the same table to `server/.seed-credentials.md` from `server/src/seed/credentials.js` — a terminal scrolls, and the population summary prints after it
- [X] T037 [US1] Add the population summary to `server/src/scripts/seed-demo.js`: per-table created and skipped counts plus elapsed time, so a run that silently did nothing is visible (FR-022, SC-010)

**Checkpoint**: The deliverable. Sign in as any role in the printed table.

---

## Phase 6: User Story 3 - The same command gives the same database (Priority: P2)

**Goal**: Two runs, two machines, one database.

**Independent Test**: Seed two fresh databases and compare.

### Tests for User Story 3

- [X] T038 [P] [US3] Create `server/tests/seed/determinism.test.js` seeding two scratch databases and comparing the generated identities — with the counter-assertion that `--random` produces a **different** set, so the test cannot pass against a generator that emits constants (SC-003)
- [X] T039 [P] [US3] Add to `server/tests/seed/determinism.test.js` an assertion that the pinned Faker version in `server/package.json` is exact, not a range — the pin is load-bearing for FR-017, not hygiene

### Implementation for User Story 3

- [X] T040 [US3] Implement `--random` in `server/src/scripts/seed-demo.js`, reseeding from entropy and printing a first line that says the run was randomised — so a varying run cannot be mistaken for a reproducible one
- [X] T041 [US3] Ensure every generator in `server/src/seed/` draws from the shared instance in `faker.js` rather than importing `faker` directly, or one module's draws would be independent of the seed

---

## Phase 7: User Story 5 - Offers and events (Priority: P2)

**Goal**: The merchant portal and the events screens have content at every stage of its life.

**Independent Test**: Sign in as a merchant and as staff; confirm the offer and event lists hold a
spread of states rather than one repeated row.

**Depends on US4** for organisations, and on US2 for members to register and redeem.

### Tests for User Story 5

- [X] T042 [P] [US5] Create `server/tests/seed/content.test.js` asserting every offer state is present — draft, published, expired, and one belonging to a suspended organisation (SC-011)
- [X] T043 [P] [US5] Add the price-constraint assertion to `server/tests/seed/content.test.js`: no seeded offer has a member price at or above its regular price, **and** the database refuses one that does — the design document's "echter Vorteil, nicht Normalpreis als Rabatt" stated as a constraint rather than a convention (SC-012)
- [X] T044 [P] [US5] Add the event assertions to `server/tests/seed/content.test.js`: all four states present, at least one event at capacity, and the database refusing both a duplicate registration and one past capacity (SC-013)
- [X] T045 [P] [US5] Add the visibility assertion to `server/tests/seed/content.test.js`: a published offer belonging to a suspended organisation is **not** member-visible — visibility depends on more than the offer's own state, which is what §5's lapsed-contract rule means

### Implementation for User Story 5

- [X] T046 [US5] Create `server/migrations/015_merchant_domain.sql` with `merchant_locations`, `offers`, `redemptions` and `redemption_feedback` per `BUSINESS_DESCRIPTION.md` §5 and feature 003's `data-model.md` §3 — including the `member_price < regular_price` check, the validity-window check, and the unique redemption `reference` that makes a retry non-duplicating
- [X] T047 [US5] Create `server/migrations/016_events.sql` with `events` and `event_registrations` per `BUSINESS_DESCRIPTION.md` §4: capacity, the three-phase registration window, the four-state machine, and a unique `(event_id, member_id)` so a member cannot register twice
- [X] T048 [US5] Enforce capacity in `server/migrations/016_events.sql` at the database rather than in application code — §4 requires it across all registration sources, and a check in one writer is a race condition with extra steps
- [X] T049 [P] [US5] Create `server/src/seed/offers.js` generating locations and offers across the lifecycle, with prices that satisfy the constraint by construction rather than by retrying until they do
- [X] T050 [P] [US5] Add redemptions and feedback to `server/src/seed/offers.js` against published offers only, with the three §5 feedback questions — so the merchant analytics screens compute something other than zero
- [X] T051 [P] [US5] Create `server/src/seed/events.js` generating events across the state machine, including one at capacity and several past ones with attendees
- [X] T052 [US5] Generate registrations in `server/src/seed/events.js` respecting the once-per-member rule and capacity, so no insert relies on a constraint being absent

**Checkpoint**: The portals have content, not just accounts.

---

## Phase 8: Everything else that holds state

**Purpose**: The rest of "seed all the tables", and the rule that keeps history honest.

- [X] T053 [P] Create `server/src/seed/content.js` seeding `assets`, `asset_variants`, `seo_metadata` and `legacy_redirects` — with variants at the declared breakpoints, because the original is never served
- [X] T054 [P] Create `server/src/seed/operations.js` seeding `push_devices`, `push_campaigns`, `push_test_recipients`, `job_definitions` and `device_approvals`
- [X] T055 Apply the consistent-history rule in `server/src/seed/operations.js` to `audit_log`, `job_runs`, `push_campaign_recipients` and `counters`: **an entry only where a seeded fact implies one**, at that fact's own timestamp. A locked member gets the entry that locked them; nothing gets invented history. The audit log is the one table nobody may edit, and filling it with fiction would be the worst possible use of it
- [X] T056 Never write `sessions`, `refresh_tokens`, `otp_challenges` or `password_reset_tokens` from `server/src/seed/` — enforced by the manifest in `tables.js` and asserted by T057
- [X] T057 [P] Create `server/tests/seed/no-live-credentials.test.js` proving those four tables are empty after a seed — a seeded session is a valid credential nobody authenticated for, which is a security hazard rather than a purity concern (SC-015)
- [X] T058 Report populated and deliberately-skipped tables in `server/src/scripts/seed-demo.js`, so "all the tables" is a checkable claim rather than an assumption (FR-035)

---

## Phase 9: Polish & Cross-Cutting Concerns

- [X] T059 Create `server/tests/seed/fixed-accounts.test.js` comparing all six `seed:dev` accounts before and after a demo seed, and asserting `seed:dev` still succeeds afterwards (SC-007)
- [X] T060 [P] Create `server/tests/seed/not-routable.test.js` asserting no seeded email lacks a `.invalid` suffix and every mobile is in the drama range — with a deliberately routable fixture that must fail it (SC-005)
- [X] T061 [P] Update `specs/003-web-console/tasks.md` to mark T068, T070 and T101 as delivered here, and note that US5 and US6 are now unblocked — this feature builds the tables they were waiting on
- [X] T062 [P] Update `CLAUDE.md` with the seed's three standing rules: the development gate, the consistent-history rule for the audit log, and the four tables that are never seeded
- [X] T063 Run every scenario in `specs/005-demo-seed/quickstart.md` end to end and record the outcome
- [X] T064 Resolve the open questions in `plan.md`: the organisation-people email namespace, whether a `--reset` path is ever wanted, and the Ofcom drama range on German members

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies
- **Foundational (Phase 2)**: Depends on Phase 1 — **blocks every story**
- **US4 (Phase 3)**: Depends on Phase 2. Blocks US5's merchant half and the organisation rows of the credentials table
- **US2 (Phase 4)**: Depends on Phase 2. Independent of US4
- **US1 (Phase 5)**: Depends on US2 and US4 — the table cannot list roles that do not exist
- **US3 (Phase 6)**: Depends on Phase 2; asserts against whatever exists
- **US5 (Phase 7)**: Depends on US4 (organisations) and US2 (members to redeem and register)
- **Phase 8**: Depends on US2 for the facts its history entries must correspond to
- **Polish (Phase 9)**: Depends on the phases it checks

### User Story Dependencies

- **US4 (P1)**: After Phase 2. First among the stories, because two identity kinds do not exist.
- **US2 (P1)**: After Phase 2. Independent of US4 — can run in parallel with it.
- **US1 (P1)**: After US2 **and** US4.
- **US3 (P2)**: After Phase 2.
- **US5 (P2)**: After US4 and US2.

### Within Each User Story

- Tests are written first and must fail before the implementation that satisfies them
- Migrations before the generators that write to their tables
- 013 strictly before 014 — a new enum value cannot be used in the transaction that adds it

### Parallel Opportunities

- T005, T006, T007 in Phase 1
- T014, T015, T016 in US4 — all three test files
- T024, T025, T026 in US2
- T031, T032, T033 in US1
- T042–T045 in US5 — all four test groups
- T049, T050, T051 in US5 — offers and events are different files
- T053, T054 in Phase 8; T060, T061, T062 in Polish
- **With capacity**: US2 and US4 run concurrently from the start, by different people

---

## Parallel Example: User Story 5

```bash
# The four test groups first — they must fail before T046-T052:
Task: "offer states in server/tests/seed/content.test.js"
Task: "price constraint, asserted by violating it"
Task: "event states, capacity, duplicate registration"
Task: "a suspended organisation's published offer stays invisible"

# Then the two generators, which are separate files:
Task: "server/src/seed/offers.js"
Task: "server/src/seed/events.js"
```

---

## Implementation Strategy

### MVP (US4 + US2 + US1)

1. Phase 1: Setup
2. Phase 2: Foundational
3. Phase 3 (US4) and Phase 4 (US2) — in parallel if there are two people
4. Phase 5 (US1) — the credentials table
5. **STOP and VALIDATE**: quickstart Scenarios 1, 2, 4, 5, 6, 7
6. Deploy to a laptop — four identity kinds, a populated console, printed credentials

That is the request answered. Offers, events and the remaining tables are what make it worth
demoing to somebody else.

### Incremental Delivery

1. Setup + Foundational → the command exists and refuses to run in the wrong place
2. + US2 → a populated member and staff console
3. + US4 → four identity kinds
4. + US1 → **MVP**: credentials for every role
5. + US3 → reproducible
6. + US5 → offers and events
7. + Phase 8 → the remaining tables, with honest history
8. + Phase 9 → the regression checks

---

## Notes

- `[P]` means a different file with no dependency on an incomplete task
- Every task names an exact path
- **The specific danger in this feature** is a suite that proves the seed ran rather than what it
  produced. Every gate is paired for that reason: coverage asserts the population is *not uniform*,
  determinism asserts `--random` *differs*, the routability check has a fixture that must *fail*
- **No trigger is disabled anywhere.** There is no delete path; idempotency is `ON CONFLICT DO
  NOTHING`. A seeder that disables a guard has removed it for everyone, not just for itself
- Building T017–T020 **unblocks feature 003's US5 and US6**, which have been waiting on exactly
  these two tables
