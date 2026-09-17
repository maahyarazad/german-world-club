# German World Club platform

One API serving three faces — member web, mobile app, staff console — plus the
public site that search engines and preview bots see.

## Layout

```
server/              Fastify 5 API. Everything testable lives in app.js;
                     server.js only listens.
client/              Vite web client.
packages/contracts/  Zod schemas, problem types and permission constants,
                     imported by the server AND every client.
specs/               Spec-kit artifacts: spec, plan, tasks, contracts.
```

`packages/contracts` exists so a field renamed in one place is a type error
everywhere else rather than a runtime surprise in one client. Adding a shape
that both the server and a client need? It goes there, not in either of them.

## Commands

```bash
npm run -w server dev          # watch mode
npm run -w server migrate      # apply migrations
npm run -w server seed:dev     # a published page and an asset with variants
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

## Conventions

- ES modules, Node 22, no TypeScript in the server.
- Errors are RFC 9457 problem+json. Clients branch on `type`, never on `detail`.
- Comments explain **why**, especially where the obvious implementation is
  wrong. If a line looks odd and the reason is not next to it, add the reason.
- Tests assert behaviour, not implementation, and carry a counter-assertion
  wherever a test would otherwise pass against a server that did nothing.
