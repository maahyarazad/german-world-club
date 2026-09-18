# Contract: The Credentials Table

**Feature**: 005-demo-seed

The output the request actually asked for. Everything else this feature builds exists to make these
rows true.

## Shape

Printed to stdout when the seed finishes, and written to `server/.seed-credentials.md`.

```
KIND      ROLE                     EMAIL                                   PASSWORD
member    active, full profile     anna.mueller@demo.invalid               demo-member
member    locked                   lukas.weber@demo.invalid                demo-member
member    legacy credential        marie.fischer@demo.invalid              (reset required)
staff     superadmin               super.demo@staff.demo.invalid           demo-super
staff     SEO only                 seo.demo@staff.demo.invalid             demo-seo
staff     push campaigns           push.demo@staff.demo.invalid            demo-push
merchant  owner, active            inhaber@alpine-hiking.merchant.demo.invalid    demo-merchant
partner   owner, active            hr@siemens-ch.partner.demo.invalid             demo-partner
```

Four columns, one row per **role** rather than per account. Hundreds of accounts share about a
dozen passwords, because one argon2id hash is computed per password and reused across every account
that shares it (research R5). That is what keeps this readable.

## Rules

### Every row signs in

SC-001 is not a spot check. An automated test takes **every** row the seed printed and drives it
through `POST /auth/sign-in`, asserting the outcome each row claims.

Rows that are not expected to authenticate say so in place of a password — `(reset required)` for a
legacy credential, `(no usable password)` for a null hash, `(locked)` for a status refusal. Those
are the interesting accounts and they belong in the table; a password column that lied about them
would be worse than omitting them.

### The table is reproducible

Two runs print the same table (FR-015). It follows from the fixed Faker seed, and it matters
because a credential table that changed under the person reading it would make the printed output
useless for anything but the run that produced it.

### Passwords are memorable, not strong

`demo-member`, `demo-seo`. Strength is meaningless for a credential printed on a terminal, and a
generated 32-character password would make the table unusable for the one thing it is for.

They are still hashed with argon2id at the platform's real cost parameters (FR-016). The tempting
shortcut is to weaken the cost for seeding; it is refused because then sign-in latency under seeded
data stops resembling production, and the one place a deliberately slow hash matters becomes the
one place nobody measures it.

### The file is gitignored

`server/.seed-credentials.md` is added to `.gitignore` in the same change that creates it.
Publishing credentials on a terminal is the point. Committing them is not, and a file that is
written before it is ignored is a file that gets committed once.

## Roles covered

Every row is chosen because it shows something different, not to make the list long.

| Kind | Roles |
|---|---|
| **member** | active with full profile · active, email unconfirmed · active, no mobile · locked · inactive · ended · legacy credential · no usable password · suppressed after bounces · holding marketplace and moderation flags |
| **staff** | superadmin · single module · several modules, mixed flags · read-only on everything held · inactive account · holding only modules with no server surface yet |
| **merchant** | owner of an active organisation · manager · owner of a suspended organisation |
| **partner** | owner of an active organisation · manager |

The last staff row is the one worth noticing: an account whose grants are all for modules the server
cannot serve yet gives the console's "noch nicht verfügbar" path a real account to be looked at
with, rather than a hypothetical.

## What the table is not

- **Not a fixture.** No automated suite depends on these accounts; they are for looking at. The six
  fixed `seed:dev` accounts remain what the suites and quickstart scenarios use, and this feature
  does not touch them.
- **Not stable across a Faker upgrade.** The generated *names* behind the roles change if the pinned
  version moves. The roles, emails and passwords do not — those are chosen, not generated.
- **Not usable anywhere but a development machine.** The command exits non-zero unless `NODE_ENV`
  is exactly `development`.
