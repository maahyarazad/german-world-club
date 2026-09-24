# `@gwc/server`

One API serving the member web client, the mobile app, and the staff console.
Fastify 5 on Node 22, PostgreSQL, Redis.

For how `server/src` is laid out — routes vs. controllers vs. application logic, and how that maps
onto Fastify plugins/decorators/hooks — see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

```bash
npm install
npm run -w server keys:generate       # paste the two keys into server/.env
npm run -w server migrate
npm run -w server seed:dev
npm run -w server dev
```

---

## The three deployment preconditions

These have **no safe default**. Production boot fails rather than guessing, and
that is deliberate: each one is wrong in a way that is invisible until it
matters, and by then it is an incident rather than a misconfiguration.

### `TRUST_PROXY` — the hop count, never `true`

Behind a CDN or a load balancer, every request arrives from the proxy's
address. A per-address rate limit then treats the entire internet as one
client: either nobody can sign in, or the limit never fires.

The fix is to tell the server how many proxies sit in front of it, so it can
count back through `X-Forwarded-For` to the real client. Both directions of
error are dangerous:

| Value | Failure |
|---|---|
| unset / `0` | Every client shares one bucket. One member's failed sign-ins lock out everyone. |
| `true` | Fastify trusts the **whole** `X-Forwarded-For` chain. A client forges a header and picks a fresh identity per request, bypassing every limit. |
| the real hop count | Correct. |

Set it to the number of proxies you actually run — usually `1`.

### `CANONICAL_ORIGIN` — the one hostname this site lives at

Every duplicate hostname that serves the same content splits its own search
ranking. The server answers any non-canonical host with a 301 and emits
`<link rel="canonical">` from this value, so there is exactly one indexable
URL per page.

It must be the full origin, scheme included: `https://german-world-club.com`.
Getting it wrong does not error — it quietly redirects real traffic to the
wrong place.

### `KEEP_ALIVE_TIMEOUT_MS` — must exceed the proxy's idle timeout

This is the one people discover through intermittent 502s that nothing
reproduces.

If the server closes an idle keep-alive socket while the proxy still believes
it is usable, the proxy sends a request into a socket that is already closing.
The request fails, the proxy reports 502, and the logs here show nothing at
all, because the request never arrived.

The default is 72 s, chosen to sit above the common 60 s proxy idle timeout.
**Raise the server's value, never lower it** — the asymmetry is the point: the
side that closes first must be the one that knows the request is finished.

---

## Environment

`src/config/env.js` validates everything at startup with Zod. An invalid value
prevents boot; it never degrades behaviour silently.

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | always | |
| `REDIS_ENABLED` | production (`true`) | Default `false`: no Redis client is registered, rate limits are per-process and the session denylist is in-memory — meaning N instances grant N× every limit. Production refuses `false` |
| `REDIS_URL` | production, or whenever `REDIS_ENABLED=true` | Ignored while `REDIS_ENABLED=false` |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | production | EdDSA. `npm run keys:generate` |
| `CANONICAL_ORIGIN`, `TRUST_PROXY` | production | See above |
| `SMSGLOBAL_API_KEY` / `_API_SECRET` / `_ORIGIN` | to send OTPs | Without them OTP sends are **refused loudly**, never skipped — a second factor that quietly does not send is not a second factor |
| `EXPO_ACCESS_TOKEN` | **production** | Boot is refused without it. Turn on *enhanced push security* for the Expo project too, so a leaked token alone cannot push to members. Unset outside production with no FCM either, the push jobs use a logging transport that records "would send" and marks deliveries sent |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | all three or none | Only for devices registered with `provider: 'fcm'`; the app registers Expo tokens, and Android reaches FCM through Expo's own credentials in EAS. A partial set refuses boot in every environment. The private key is a secret: environment or secret manager, never a JSON file in the repo |
| `MEDIA_*` | defaults are fine locally | Storage driver, size and pixel bounds, per-account quota |

---

## What fails the build

Four startup gates. Each converts a defect that is normally caught in review —
if at all — into a process that will not start.

| Gate | Refuses to boot when | Where |
|---|---|---|
| Route posture | A route does not declare `config.auth` | `plugins/11-rbac.js` |
| Response shape | A route declares no `schema.response` and no `config.produces` | `plugins/11-rbac.js` |
| Budget rule | Σ(outbound budgets) ≥ route deadline, or a deadline ≥ `requestTimeout` | `config/budgets.js` |
| Breaker policy | A dependency declares no fallback behaviour | `config/breakers.js` |

Making a route public is an affirmative act that appears in a diff. Silence is
never a default in either direction.

---

## Plugin order is semantic

The numeric filenames are load-bearing, not cosmetic:

```
00 request-context   correlation id before anything logs
01 logging           redaction before any field is emitted
02 security-headers  posture before any route answers
05 db  06 redis      dependencies before their consumers
07 rate-limit        cheap refusal before authentication spends a lookup
08 under-pressure    shed before the work starts
09 jwt  10 auth      authenticate before authorize
11 rbac              the registry the posture gate reads
12 deadline          a budget before a handler runs
13 breakers          outbound isolation
14 error-handler     one envelope for everything above
15 openapi           BEFORE the route plugins — it collects routes via onRoute
```

Two orderings people change and regret: rate limiting **before** authentication,
so an unauthenticated flood is cheap to refuse; and OpenAPI **before** the
routes, because a Fastify `onRoute` hook only fires for routes registered after
it — registered last, the document comes out empty.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run -w server dev` | Watch mode |
| `npm run -w server migrate` | Apply migrations (`migrate:down` to roll back one) |
| `npm run -w server seed:dev` | A published page, an asset with variants |
| `npm run -w server keys:generate` | A fresh EdDSA keypair |
| `npm run -w server test` | Vitest. SQL-backed suites skip loudly without a database |
| `npm run -w server verify:seo` | Crawl the real sitemap: status codes, metadata uniqueness, JSON-LD validity. Exits non-zero, so it can gate a deploy |
| `npm run -w server bench:push` | Development only. After `seed:perf`: one broadcast to a synthetic device per member through a stub transport, timed against SC-002's 10 minutes. Cleans up after itself |

---

## The API reference

`GET /admin/docs` renders the OpenAPI document as a browsable Swagger UI.
`GET /admin/openapi.json` is the same document as JSON.

**Both require a staff session holding `settings.read`.** Neither is public,
and that is a deliberate posture rather than an oversight: the document
describes the whole gated surface of an invite-only club, so publishing it
publishes the shape of the admin API to anyone who finds the URL. `/admin` is
already classified gated-and-never-indexed in `src/modules/seo/surfaces.js`, which is
what gives the docs their `X-Robots-Tag: noindex, nofollow`, their
`Cache-Control: private, no-store`, and their `Disallow` line in `robots.txt`
without a second declaration anyone could forget to make.

Two things about it will look odd in a diff, and both are load-bearing:

- **The docs get their own Content-Security-Policy.** `@fastify/swagger-ui`
  installs an `onSend` hook, confined to its own scope, that replaces helmet's
  global policy for these routes. It is *not* a relaxation to `unsafe-inline`:
  the bundle externalises its scripts, so the policy it sets still requires
  `script-src 'self'`. It differs from the global policy only in allowing the
  bundle's stylesheet and `validator.swagger.io` as an image source. The global
  policy is untouched, and a test asserts a public route still gets the strict
  one.
- **The rate-limit bucket is attached as an explicit hook, not via
  `config.rateLimit`.** `@fastify/rate-limit` reads that config in its own
  `onRoute` hook, which is registered at the root long before the docs scope
  exists — so it runs first, reads a config not yet written, and builds no
  limiter at all. Silently: the route answers normally with no `RateLimit-*`
  headers and no counting. See the comment in `src/plugins/15-openapi.js`.

### The development copy

`GET /swagger-ui` is the same UI with no authentication at all — and it exists
only when `NODE_ENV=development`. On a laptop the gated mount costs a staff
account, a grant and a token before you can read your own API, and the argument
above is about a public origin serving real members, which a development
process is not.

The exemption is the *registration*, not a check inside a handler: outside
development those routes are never added to the router, so an unauthenticated
request gets a 404 from the ordinary not-found handler rather than a refusal
that confirms the surface exists. `test` and `production` both take that path,
and a test asserts it for every route in the subtree, the static bundle
included. The mount still declares `{ audience: 'public' }` for the gate, is
still counted against the IP-keyed `public-read` bucket, and still carries
`X-Robots-Tag: noindex` — a URL that leaks out of a dev machine through a
referrer should not become a search result.

If you need the document in CI without a staff session, generate it from the
built app rather than loosening the route or setting `NODE_ENV=development`.

---

## Shutdown

`SIGTERM` runs, in this order: fail readiness, wait one probe interval, stop
accepting, drain in-flight requests for 15 s, close the pool and Redis.

Failing readiness **first** is the part that matters. A load balancer that still
believes the instance is ready keeps routing work into a process that has
stopped accepting it, and those requests fail for no reason at all.
