# `@gwc/server`

One API serving the member web client, the mobile app, and the staff console.
Fastify 5 on Node 22, PostgreSQL, Redis.

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
| `REDIS_URL` | production | Without it, rate limits are per-process and the session denylist is unavailable — meaning N instances grant N× every limit |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | production | EdDSA. `npm run keys:generate` |
| `CANONICAL_ORIGIN`, `TRUST_PROXY` | production | See above |
| `SMSGLOBAL_API_KEY` / `_API_SECRET` / `_ORIGIN` | to send OTPs | Without them OTP sends are **refused loudly**, never skipped — a second factor that quietly does not send is not a second factor |
| `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` | for FCM push | Service account. The private key is a secret: environment or secret manager, never a JSON file in the repo |
| `EXPO_ACCESS_TOKEN` | only with Expo enhanced security | Expo needs no server credential otherwise |
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

---

## Shutdown

`SIGTERM` runs, in this order: fail readiness, wait one probe interval, stop
accepting, drain in-flight requests for 15 s, close the pool and Redis.

Failing readiness **first** is the part that matters. A load balancer that still
believes the instance is ready keeps routing work into a process that has
stopped accepting it, and those requests fail for no reason at all.
