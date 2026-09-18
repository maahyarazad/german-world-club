# Quickstart: Validating the Server Clean Architecture Reorganization

This is a structural refactor with zero intended behavior change. There is nothing new to "try" as
a feature — validation means proving the app behaves identically after each domain is moved, and
proving the new structure actually satisfies the three user stories in `spec.md`.

## Prerequisites

- Node 22, workspace dependencies installed (`npm install` at repo root)
- A database reachable by the server's test config, since some suites skip loudly without one (per
  `CLAUDE.md`) — set up per `server/README.md`

## Per-domain regression check (run after each domain migration step)

```bash
# Run just the domain's own suite first (fast feedback)
npm run -w server test -- tests/<domain>

# Then the full server suite, to catch any cross-domain import breakage
npm run -w server test

# Full workspace, since client-side i18n/no-hardcoded-strings tests and contracts
# package are shared dependents of anything under packages/contracts
npm test
```

**Expected outcome**: identical pass/fail results to the pre-migration baseline. Any new failure is
a regression introduced by the move (wrong import path, dropped `config.auth`, dropped
`schema.response`) — not an acceptable "will fix in the follow-up" outcome, per FR-006.

## Whole-feature verification (after all domains + app.js decorators/hooks are moved)

```bash
npm run -w server test          # SC-002: 100% of existing suite passes
npm run -w server verify:seo    # crawls the real sitemap; catches any accidental route/posture drift
npm test                        # every workspace, including client i18n and no-hardcoded-strings
```

**Expected outcome**: all green, with no test content changed — only import paths inside test files
that reference a moved source file.

## Validating the user stories directly

**User Story 1** (find a route's layers in under 2 minutes): open
`server/src/modules/auth/routes.js`, confirm it contains only path/method/`config.auth`/
`schema.response` declarations and a call into `controller.js`; open `controller.js`, confirm it
only shapes the request into an application call and the result into a reply; open
`application/sign-in.js`, confirm the actual sign-in rule (password check, lockout, session start)
lives there with no `request`/`reply` object touched directly.

**User Story 2** (add an endpoint by copying the pattern): pick any already-migrated domain (e.g.
`modules/organisations/`) as the reference slice; confirm a new, simple endpoint can be added by
creating one route entry, one controller function, and one application function, without touching
any other domain's files.

**User Story 3** (learn Fastify's structure from the repo): read the new `server/ARCHITECTURE.md`
(FR-008); confirm it names a real file for "this is a plugin" (e.g.
`src/plugins/07-rate-limit.js`), "this is a decorator" (e.g. `src/decorators/send-otp.js`), and
"this is a hook" (e.g. `src/hooks/csrf-on-request.js`), and that the numbered plugin boot order is
explained with the same rationale already in `CLAUDE.md`, not a new/conflicting explanation.

## Rollback

Each domain migration is one commit (or one small PR). Reverting a single domain's commit restores
its previous `routes.js` without affecting domains already migrated, since `app.js`'s registration
calls only change the import path for that one domain.
