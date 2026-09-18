# Contract: The `seed:demo` Command

**Feature**: 005-demo-seed

## Invocation

```bash
npm run -w server seed:demo                    # deterministic, default volumes
npm run -w server seed:demo -- --members=50    # smaller
npm run -w server seed:demo -- --random        # vary the data, and say so
```

Separate from `seed:dev`, which is unchanged. One command that did both would put hundreds of rows
into every test run and bury the six fixed accounts among them.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--members=N` | 200 | Member count |
| `--staff=N` | 12 | Staff count |
| `--merchants=N` | 8 | Merchant organisations |
| `--partners=N` | 6 | Partner organisations |
| `--random` | off | Vary the data instead of reproducing it |
| `--quiet` | off | Suppress the population summary, keep the credentials table |

Volumes are adjustable without editing code (FR-021). The credentials table is never suppressed —
it is the output, not a progress message.

## Guarantees

### It refuses to run outside development

```
refusing to seed: NODE_ENV is "production", not "development".
This command creates accounts with published passwords and must never touch a shared database.
```

Exit code 1. `development` **exactly**, not `!isProduction`: staging runs as production, and a CI
database is no place for published credentials either. This copies `seed-dev.js` rather than
inventing a second convention.

### It never touches what it did not create

The six fixed `seed:dev` accounts are read-only to this command, and it has no delete path at all.

`members` refuses `DELETE` by trigger (§12.4). The test helper gets around that by disabling the
trigger, which is defensible inside a suite that re-enables it two lines later and not defensible
in a command someone runs by hand. Idempotency is `ON CONFLICT (email) DO NOTHING` instead — which
satisfies FR-019 without a destructive path existing to be misused.

Generated identities also live at their own domains (`@demo.invalid` and friends), so a generated
address cannot shadow a fixed one even if Faker produced the same local part.

### Nothing it writes can reach a real person

- **Emails** end in `.invalid`, reserved by RFC 2606, which can never resolve in any DNS.
  Faker's `internet.email()` returns real domains — `Luiz60@hotmail.com` was the first thing it
  produced in testing — so the provider is always overridden. A seeded member with a live address
  is one misconfigured mail integration away from sending a stranger a password reset.
- **Phone numbers** come from Ofcom's drama range, `+44 7700 900000`–`900999`, reserved so fiction
  cannot dial a real handset. A British number on a German member reads oddly; a real handset
  receiving a real OTP reads much worse.

"The mail integration is stubbed in development" is a property of today's configuration, not a
control.

### Running it twice changes nothing

Same rows, same counts, same credentials. Determinism comes from a fixed Faker seed and a fixed
reference date; idempotency from the conflict clause.

### It says what it did

```
seed:demo — deterministic (seed 20260917), faker 10.6.0

  members         200 created,   0 skipped
  staff            12 created,   0 skipped
  merchants         8 organisations,  14 people
  partners          6 organisations,  11 people

  completed in 3.1s
```

Enough to tell a successful run from one that silently did nothing (FR-022), and the elapsed time
because a seed slow enough to skip is a seed nobody runs (SC-010).

With `--random` the first line says so, so a run with varying data cannot be mistaken for a
reproducible one.

## Schema it depends on

Two migrations, in order, both shipped by this feature:

1. `013_organisation_principals.sql` — widens `account_kind` with `merchant` and `partner`, and
   **does nothing else**. A new enum value cannot be used in the transaction that adds it, and
   `migrate.js` wraps each file in one.
2. `014_organisations.sql` — `organisations` and `organisation_users`, per feature 003's
   `data-model.md` §1.

The command fails with a clear message if the database is not migrated to at least 014, rather than
producing a partial population and a confusing error.

## What it does not do

- No offers, redemptions, entitlements, vacancies, events or approval submissions. Those tables do
  not exist; building one in order to seed it is how demo data becomes the schema.
- No sessions, refresh tokens or OTP challenges. Those are created by signing in, and seeding them
  would mean inventing state the auth code is responsible for.
- No audit-log entries. The log is append-only and records what actually happened; writing
  fabricated history into it would make the one table nobody may edit the one table full of fiction.
