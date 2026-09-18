# Quickstart: Demo Seed

**Feature**: 005-demo-seed

How to fill a development database and prove the result. Shapes live in
[`data-model.md`](./data-model.md) and [`contracts/`](./contracts/); this is the run guide.

## Prerequisites

```bash
npm install
npm run -w server migrate      # must include 013 and 014
```

`NODE_ENV` must be `development`. The command refuses anything else, and that is the point.

## Run

```bash
npm run -w server seed:demo
```

It prints a population summary and then the credentials table. Keep the table; it is the output.

```bash
npm run -w server dev          # API on :3000
npm run -w client dev          # Vite, proxying the API
```

Open the Vite origin and sign in with any row.

---

## Scenario 1 — Every printed credential works (User Story 1)

1. Run the seed and read the table.
2. For each row, sign in at `/konsole/anmelden`.
3. **Expect**: rows with a password authenticate and land in that identity's console area. Rows
   marked `(reset required)`, `(no usable password)` or `(locked)` produce exactly the outcome they
   name — those are the interesting accounts, and the table would be lying if it omitted them.
4. Sign in as the staff row marked *SEO only*.
5. **Expect**: the sidebar offers SEO. Not one entry, not all of them.
6. Open the member list.
7. **Expect**: enough rows to be worth paginating, with names that read like people.

**Verifies**: FR-013, FR-014, SC-001.

## Scenario 2 — The population is not uniform (User Story 2)

Query it rather than scrolling it — the point is coverage, not appearance:

```sql
SELECT status, count(*) FROM members WHERE email LIKE '%@demo.invalid' GROUP BY status;
SELECT count(*) FROM members WHERE email LIKE '%@demo.invalid' AND password_hash ~ '^[0-9a-f]{32}$';
SELECT count(*) FROM members WHERE email LIKE '%@demo.invalid' AND email_confirmed_at IS NULL;
SELECT count(*) FROM members WHERE email LIKE '%@demo.invalid' AND email_suppressed;
```

**Expect**: all four statuses present; at least one legacy MD5 hash; unconfirmed emails; suppressed
addresses.

Then the staff matrices:

```sql
SELECT admin_user_id, count(*) AS modules FROM admin_permissions GROUP BY 1 ORDER BY 2;
```

**Expect**: a spread — at least one account with a single module, and one superadmin. A member list
where every row is `active` proves nothing about how the other three render, which is why this is
checked rather than assumed.

**Verifies**: FR-007 … FR-010, SC-002.

## Scenario 3 — The same command gives the same database (User Story 3)

```bash
createdb gwc_seed_a && createdb gwc_seed_b
DATABASE_URL=...gwc_seed_a npm run -w server migrate && DATABASE_URL=...gwc_seed_a npm run -w server seed:demo
DATABASE_URL=...gwc_seed_b npm run -w server migrate && DATABASE_URL=...gwc_seed_b npm run -w server seed:demo
```

Compare the generated identities from each — emails, names, statuses, ordered.

1. **Expect**: identical.
2. Run the seed a second time against one of them.
3. **Expect**: no row count changes and the credentials table is unchanged.
4. Run with `--random`.
5. **Expect**: different data, and a first line that says the run was randomised — so a varying run
   can never be mistaken for a reproducible one.

**Verifies**: FR-017 … FR-019, SC-003, SC-004.

## Scenario 4 — Merchant and partner principals exist (User Story 4)

1. Sign in with the merchant owner credential.
2. **Expect**: authenticated as a merchant, landing in the merchant area.
3. With that session, request a staff route and a member route.
4. **Expect**: refused — a credential for one audience never satisfies another. This is the same
   property member and staff already have, extended rather than weakened.
5. Repeat with the partner credential.
6. Query an organisation's people.
7. **Expect**: each carries a role, and exactly one is an `owner`.
8. Try to delete an organisation directly.

```sql
DELETE FROM organisations WHERE slug = 'alpine-hiking';
```

9. **Expect**: refused by trigger. Ending a commercial relationship is a status transition that
   preserves history, and the prohibition lives in the database so it survives an ad-hoc query.

**Verifies**: FR-006, FR-011, FR-012, SC-008, SC-009.

## Scenario 5 — Nothing can reach a real person (safety)

```sql
SELECT count(*) FROM members WHERE email NOT LIKE '%.invalid';
SELECT DISTINCT left(mobile, 8) FROM members WHERE mobile IS NOT NULL;
```

1. **Expect**: zero routable addresses. Every generated email ends in `.invalid`, which RFC 2606
   reserves and which can never resolve in any DNS.
2. **Expect**: every mobile in Ofcom's drama range, `+447700900…`, reserved so fiction cannot dial
   a real handset.

Faker's own `internet.email()` returns live domains — `Luiz60@hotmail.com` was the first thing it
produced in testing — so this is checked rather than trusted.

**Verifies**: FR-002, FR-003, SC-005.

## Scenario 6 — It refuses to run where it must not (safety)

```bash
NODE_ENV=test npm run -w server seed:demo        # expect: refusal, exit 1
NODE_ENV=production npm run -w server seed:demo  # expect: refusal, exit 1
```

**Expect**: both refuse and say why. `development` exactly, not `!isProduction` — staging runs as
production, and a CI database is no place for published credentials either.

**Verifies**: FR-001, SC-006.

## Scenario 7 — The fixed accounts are untouched (regression)

1. Note the six `seed:dev` accounts and their state.
2. Run `seed:demo`.
3. **Expect**: all six unchanged — same emails, same hashes, same grants.
4. Run `seed:dev` again.
5. **Expect**: it still works exactly as before.
6. Run the DB-backed server suites.
7. **Expect**: unaffected. No suite depends on demo data; the fixed accounts remain what the tests
   and quickstart scenarios use.

**Verifies**: FR-005, FR-020, SC-007.

---

## Automated gates

```bash
npm run -w server test          # includes the seed suites below
npm run -w server seed:demo     # the command itself is the other half
```

| Gate | Criterion | The counter-assertion it must carry |
|---|---|---|
| Every credential signs in | SC-001 | driven from the **printed** table, so a row that stops working fails |
| State coverage | SC-002 | asserts presence of each state, and that the population is **not** uniform |
| Determinism | SC-003 | two seeded sets are identical, **and** `--random` produces a different one |
| Idempotency | SC-004 | a second run adds zero rows, and the first run added more than zero |
| Nothing routable | SC-005 | a deliberately routable fixture address fails the check |
| Development gate | SC-006 | refuses under `test` and `production`, **and** permits `development` |
| Fixed accounts intact | SC-007 | compares all six before and after, and `seed:dev` still succeeds |
| Audience isolation | SC-008 | all four kinds, each refused by the other three's routes |

A suite that only proved the seed *ran* would pass against a seed that inserted one row. Each gate
above is paired for that reason.

---

## Run record (T063)

Every scenario above executed end to end on 2026-09-17, Postgres 16 on localhost.

| Scenario | Outcome |
|---|---|
| 1 — Every printed credential works | **Pass.** 27 rows across all four identity kinds; `tests/seed/credentials.test.js` drives each against a live server (32 assertions). Rows marked `(reset required)` / `(no usable password)` return `password_reset_required` with no principal; `(locked)` and suspended-organisation rows return problem+json |
| 2 — The population is not uniform | **Pass.** members: active 162, locked 14, inactive 14, ended 10; 8 legacy MD5 hashes; 16 unconfirmed emails; 4 suppressed. Staff matrices: 6 accounts with one module, 4 with two, 1 superadmin — no two alike |
| 3 — Same command, same database | **Pass.** `gwc_seed_a` and `gwc_seed_b` fingerprint identically (`65cc46f3…`); a second run on `gwc_seed_a` left members at 200 and printed a byte-identical credentials table; `--random` produced `46fcdbae…` and announced *"RANDOMISED. This run is not reproducible."* |
| 4 — Merchant and partner principals exist | **Pass.** 14 organisations, 16 people, every one with exactly one owner and a spread of statuses (active, pending, suspended). `DELETE FROM organisations` refused: *"organisations cannot be deleted; set status to 'ended' instead"*. Audience isolation covered by `tests/seed/audiences.test.js` — twelve refusals and four admissions |
| 5 — Nothing can reach a real person | **Pass.** Zero routable addresses; every mobile `+4477009…`. `tests/seed/not-routable.test.js` widens this to *every text column of every table*, and was verified by planting `kontakt@echte-firma.de` in an offer's free-text conditions — which it caught |
| 6 — It refuses to run where it must not | **Pass.** `NODE_ENV=test` and `NODE_ENV=production` both exit 1 with *"refusing to seed: NODE_ENV is …, not 'development'"*. The gate runs before `loadEnv()`, which would otherwise throw first and never mention seeding |
| 7 — The fixed accounts are untouched | **Pass.** All six `seed:dev` accounts byte-identical after a demo seed, including password hashes; all six still sign in; `seed:dev` runs again afterwards without error |

Two things the run surfaced that the scenarios did not ask for, both now fixed:

- **`counters` was in the manifest and empty.** The populated/skipped report added at T058 printed
  `WRITABLE BUT EMPTY — counters (0)`, which is exactly what that report is for. Seeded assets now
  carry an uploader and each `media.stored_bytes` counter is `sum(bytes)` over that member's assets,
  computed by Postgres in the insert — history derived from a seeded fact, never invented. 24/24.
- **`seed:dev` claimed merchant and partner "have no tables yet".** True when it was written, false
  since migration 014. Corrected to say it seeds none on purpose and to point at `seed:demo`.
