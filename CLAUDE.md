# German World Club platform

One API serving three faces — member web, mobile app, staff console — plus the
public site that search engines and preview bots see.

## Layout

```
server/              Fastify 5 API. Everything testable lives in app.js;
                     server.js only listens. See server/ARCHITECTURE.md for
                     how src/ is laid out (routes/controllers/application,
                     plugins/decorators/hooks).
client/              Vite web client.
packages/contracts/  Zod schemas, problem types and permission constants,
                     imported by the server AND every client.
specs/               Spec-kit artifacts: spec, plan, tasks, contracts.
```

`server/src/plugins/` holds the numbered Fastify bootstrap (unchanged by feature
006); `server/src/decorators/` and `server/src/hooks/` hold the cross-cutting
`app.decorate`/`app.addHook` calls that used to sit inline in `app.js`; each
HTTP-facing feature lives under `server/src/modules/<domain>/` split into
`routes.js` (schema + posture + wiring), `controller.js` (request/reply
shaping) and `application/` (the actual business rule, framework-free).

`packages/contracts` exists so a field renamed in one place is a type error
everywhere else rather than a runtime surprise in one client. Adding a shape
that both the server and a client need? It goes there, not in either of them.

## Commands

```bash
npm run -w server dev          # watch mode
npm run -w server migrate      # apply migrations
npm run -w server seed:dev     # a published page and an asset with variants
npm run -w server seed:demo    # the full demo population, with a credentials table
npm run -w server test         # vitest; SQL suites skip loudly without a DB
npm run -w server verify:seo   # crawl the real sitemap, exit non-zero on problems
npm test                       # every workspace
```

`server/README.md` covers the three deployment preconditions — `TRUST_PROXY`,
`CANONICAL_ORIGIN`, `KEEP_ALIVE_TIMEOUT_MS` — and why none of them has a safe
default.

## Things that will bite you

**Plugin filenames are numbered because the order is semantic.** Correlation
before logging, security headers before routes, rate limits before
authentication (so an unauthenticated flood is cheap to refuse), authentication
before authorization, deadlines before handlers. Renaming or reordering them
changes behaviour. `15-openapi.js` in particular must register **before** the
route plugins: `@fastify/swagger` collects routes through an `onRoute` hook,
and a Fastify `onRoute` hook only fires for routes registered after it.

**A third-party plugin's routes are still your routes.** A plugin that
registers routes of its own — `@fastify/swagger-ui`, `@fastify/static` —
declares no posture for them, so a bare registration does not produce an
unguarded route, it produces a server that will not boot. Register it inside an
encapsulated scope and declare the posture once for the whole subtree with a
scope-level `onRoute` hook; `11-rbac.js` defers its judgement to `onReady`
precisely so that hook has run. Enforce with a scope-level `onRequest` hook
rather than the plugin's own hook option: swagger-ui's `uiHooks` are not passed
to the `@fastify/static` registration serving its bundle, so using them would
have gated the page and left the assets open. Watch for config that another
plugin reads at `onRoute` time — a `config.rateLimit` stamped by a scope hook
arrives after `@fastify/rate-limit` has already looked, and builds no limiter
at all without saying so.

**An environment-only route is a registration, not a check.** `/swagger-ui` is
the unauthenticated API reference, and it exists only when
`NODE_ENV=development` because the whole `app.register` is inside the `if` —
not because a handler asks what environment it is in. Outside development there
is no route, so there is no posture to get wrong and no refusal confirming the
surface exists; the test for it asserts `404` rather than `401`. The gated
`/admin/docs` mount is unchanged in every environment, which is the point:
production behaviour never depends on reading a conditional correctly.

**Four gates refuse to boot**, rather than letting a defect through to review:

- a route with no `config.auth`
- a route with no `schema.response` and no `config.produces`
- Σ(outbound budgets) ≥ the route's deadline
- a dependency with no declared fallback

Adding a route means declaring both its access posture and what it sends back.
Making it public is an affirmative act that shows up in a diff.

**Rate limits are not quotas.** A 429 means "retry later and it will work". A
business quota — invitations, coupons, event capacity, stored bytes — means
retrying changes nothing until state does. Quotas live in PostgreSQL under a
row lock via `db/counters.js`, never in the rate limiter, because they must be
exact under concurrency, survive a Redis flush, and be auditable.

**Authorization is never read from the token.** Permissions are resolved per
request, so a revoked grant takes effect on the *next* request rather than when
the token happens to expire.

**The original upload is never served.** Clients get derivatives at declared
breakpoints. The original is a storage artefact, and `verify:seo` plus the
media suites both assert no response references it.

**Two languages, two mechanisms, for opposite reasons.** The console switches in
place and remembers the choice in the browser; the public landing pages switch
by *link*, because they run no JavaScript at all and the platform already serves
one URL per language (`about`/`about-us`, `impressum`/`imprint`). `/` and `/en`
are a translation pair: each is canonical for **itself**, and their hreflang set
is derived from a shared `translation_group_id` so a one-directional
declaration — which search engines ignore, suppressing both pages — cannot be
written. Canonicalising `/en` onto `/` delists the English page entirely; that
is the single most consequential line in the feature.

**Interface strings live in `client/src/i18n/`, one module per locale, read
through `useTranslations()`.** A component that imports a catalogue directly
hard-codes its language and survives every switch silently, so
`tests/no-hardcoded-strings.test.js` refuses one. `npm run -w client test:i18n`
fails the build when the catalogues disagree on any key, **in either
direction** — a missing translation is otherwise invisible until someone
switches language on the one screen that uses it. Formatting follows the locale
too: translating labels while leaving `1.240,50 €` in an English interface is
the half-done version of the feature.

**The server emits no localised text, and that is deliberate.** Problem `detail`
stays English and the console translates on `type`, which is why a second
language cost no server change at all. `tests/ops/no-server-localisation.test.js`
asserts no response body varies with `Accept-Language`, because "localise the
API too" is the obvious next step and it is not one this platform takes.

**The demo seed has three standing rules.** `seed:demo` (feature 005) fills every
table and prints a credentials table with a working password for each role, so
it is **development-only, enforced by a gate that runs before `loadEnv()`** —
under `NODE_ENV=production` or `test` it refuses and explains why. Publishing
passwords is the deliberate point of the command, which is exactly why it must
never run anywhere real.

`sessions`, `refresh_tokens`, `otp_challenges` and `password_reset_tokens` are
**never seeded**. A seeded session is a valid credential nobody authenticated
for and a seeded reset token is a working password-reset link sitting in a
table — with the demo passwords published, both are live. `src/seed/tables.js`
is the manifest and `tests/seed/no-live-credentials.test.js` enforces it twice:
statically against the seeder's source, and against the database after a run.
Those tables fill themselves on sign-in, which is the only way they should.

History tables follow the **consistent-history rule: an entry only where a
seeded fact implies one, at that fact's own timestamp and its own value.** A
member whose status is `locked` gets the entry that locked them, stamped
`status_changed_at`; a `media.stored_bytes` counter is `sum(bytes)` over that
member's assets, computed by Postgres in the insert. Nothing gets invented
history. The audit log is the one table nobody may edit, and filling it with
fiction would be the worst available use of it.

`seed:demo` is additive and idempotent, and it never deletes: `members` and
`organisations` both refuse `DELETE` by trigger, and a seeder that disabled a
trigger to make itself re-runnable is one tab-completion from the wrong
database. Generated identities live at `@*.demo.invalid` so they can never
collide with the six fixed `@test.invalid` accounts `seed:dev` creates — which
`tests/seed/fixed-accounts.test.js` checks by comparing password hashes, because
a collision that rewrote one leaves the row count unchanged.

**A commercial counterparty is neither a member nor staff.** `merchant` and
`partner` are their own audiences with their own tables (`organisations`,
`organisation_users`), because §5 is emphatic that a merchant is not a member
and a corporate partnership is expressly not a membership. Audience isolation
is enforced at token verification, but it cannot express "your own
organisation" — that is `guardOrganisationScope` in `authz/object-guards.js`,
and it answers **404, not 403**, so a merchant login cannot enumerate the club's
partners by guessing uuids.

## Conventions

- ES modules, Node 22, no TypeScript in the server.
- Errors are RFC 9457 problem+json. Clients branch on `type`, never on `detail`.
- Comments explain **why**, especially where the obvious implementation is
  wrong. If a line looks odd and the reason is not next to it, add the reason.
- Tests assert behaviour, not implementation, and carry a counter-assertion
  wherever a test would otherwise pass against a server that did nothing.
