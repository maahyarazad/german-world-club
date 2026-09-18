# Contract: Resilience — Timeouts, Circuit Breakers, Rate Limits

**Feature**: `002-server-platform` | **Research**: [R7, R8, R9](../research.md)

Three mechanisms, often confused, doing three different jobs:

| Mechanism | Answers | Protects |
|---|---|---|
| **Timeout** | "How long may this take?" | The server's own resources |
| **Circuit breaker** | "Is this dependency healthy?" | The dependency, and the latency of everything else |
| **Rate limit** | "How often may this caller ask?" | The server against abuse and cost |

A system with only one of the three has a well-understood failure mode: timeouts alone let a failing dependency be hammered; breakers alone let a single slow call hang a request forever; rate limits alone do nothing about a dependency outage.

---

## 1. Timeouts — four layers and a budget rule (FR-032)

**Verified in this environment**: Fastify's `requestTimeout` defaults to **`0` — disabled**. `headersTimeout` is 60 s and `keepAliveTimeout` is 72 s. The server as delivered will hold a stalled request open indefinitely.

| Layer | Mechanism | Value | Covers | On expiry |
|---|---|---|---|---|
| 1. Socket | `requestTimeout` | 30 s | Client never finishes sending | Node sends 408, closes |
| 2. Connection | `connectionTimeout` | 35 s | Idle socket; prerequisite for `onTimeout` to fire | Socket closed |
| 3. Handler deadline | `AbortSignal.any([AbortSignal.timeout(budget), clientDisconnect])` | 2–10 s by class | Handler blocked on a query or dependency | 503 `request-deadline-exceeded` |
| 4. Outbound | `undici` `headersTimeout`/`bodyTimeout`; `pg` `statement_timeout` | per dependency | Dependency accepts then stalls | Dependency error → breaker |

`AbortSignal.timeout` and `AbortSignal.any` are both available on Node 22, so layer 3 needs no dependency. The signal is passed into `pg` and `undici`, so expiry **cancels the underlying work** rather than merely abandoning the caller — a `Promise.race` against a bare timer answers the client while leaving the query running and the connection busy.

### Route budgets

| Class | Deadline | Rationale |
|---|---|---|
| Public page render | 3 s | Slow public pages cost rankings (§10.9) |
| `sitemap.xml` | 10 s | A full content query; cached 1 h |
| Auth (sign-in, refresh) | 5 s | Includes argon2 verification, deliberately costly |
| OTP send | 6 s | One outbound SMS (5 s) + margin |
| Member read | 2 s | |
| Member write | 5 s | |
| Checkout / payment | 12 s | One payment call (8 s) + margin |
| Admin report / export | 30 s | Explicitly long-running; matches `requestTimeout` |

### The budget rule (FR-033)

> For every route: **Σ(outbound budgets it may incur) < its handler deadline < `requestTimeout`.**

Asserted at startup over the budget table, not left to review. Violating it inverts the failure: the caller gives up first, retries, and the retry arrives while the original is still running — the standard path by which a slow dependency becomes an outage.

### Two things that are easy to get wrong

- **`onTimeout` cannot respond.** Fastify's documentation is explicit that the socket is already hung up. It is a place to record a metric; the client's error comes from layer 1 or 3.
- **`keepAliveTimeout` must exceed the proxy's idle timeout**, or the proxy reuses a socket the server is closing and sporadic 502s appear. Fastify's 72 s default is already chosen with this in mind; it is documented as a deployment precondition rather than lowered. `forceCloseConnections: 'idle'` is set so graceful shutdown can complete.

---

## 2. Circuit breakers — `opossum`, one per outbound dependency (FR-035)

| Dependency | Timeout | Threshold | Reset | Unavailable behaviour | Retry safe? |
|---|---|---|---|---|---|
| Payments | 8 s | 50% / 10 req | 60 s | **Fail closed** — explicit failure; never record success | No, unless carrying the idempotency reference (§12.5) |
| SMS / OTP | 5 s | 50% / 20 req | 30 s | Refuse sign-in, `otp-unavailable`, retry later | Yes, same code within validity |
| SMTP / mail | 10 s | 60% / 20 req | 60 s | Enqueue for later delivery | Yes — queue keyed by message id |
| Geocoding | 3 s | 50% / 10 req | 120 s | Save record without coordinates; backfill | Yes |
| Redis | 250 ms | 50% / 50 req | 10 s | Per-bucket `skipOnError` (see §3) | Yes |

### `errorFilter` — the load-bearing detail (FR-036)

```js
errorFilter: (err) => {
  if (err.statusCode >= 400 && err.statusCode < 500) return true  // do NOT count
  if (err.code === 'CARD_DECLINED')                  return true  // business outcome
  return false                                                     // count: timeout, 5xx, ECONNREFUSED
}
```

A declined card, an invalid phone number, or any 4xx is a **business outcome**, not a dependency failure. Without this filter, a busy evening of legitimately declined cards trips the payment breaker and takes payments down for everyone — an outage caused by the protection itself. SC-012 tests exactly this.

### Fail-closed payments (FR-037)

A breaker's usual kindness is a fallback value. For payments there is no safe fallback: one that lets checkout proceed hands out membership cards and event seats for free. The policy is an explicit failure.

A retry through a breaker is therefore only applied to operations that are safe to repeat (FR-038), and §12.5's deterministic invoice reference is what makes repeating a payment harmless once the dependency recovers — the same invoice is reused rather than a second one generated.

### States

`closed` → (threshold crossed) → `open` → (reset elapsed) → `half-open` → one trial call → `closed` on success, `open` on failure. Recovery is automatic and requires no deploy (SC-011). Every transition is logged and surfaced as a metric.

### Inbound is a different tool

`@fastify/under-pressure` sheds load with 503 + `Retry-After` on event-loop delay or heap pressure, and backs readiness (FR-045, FR-050). `@fastify/circuit-breaker` is **not used** — it breaks inbound routes by error rate, duplicating `under-pressure`, and does nothing for outbound isolation.

---

## 3. Rate limits — named buckets

`@fastify/rate-limit` with a Redis store, configured as a table. Every bucket sets `skipOnError` explicitly (FR-044).

| Bucket | Dimension | Allowance | `skipOnError` | Applies to |
|---|---|---|---|---|
| `public-read` | client address | 300 / min | **true** (fail open) | Public pages, sitemap, robots |
| `sign-in-ip` | client address | 10 / 15 min | false | `POST /auth/sign-in` |
| `sign-in-account` | email | 5 / 15 min | false | `POST /auth/sign-in` |
| `otp-send` | phone number | 3 / h + 60 s cooldown | false | OTP dispatch |
| `otp-verify` | challenge | 5 attempts | false | `POST /auth/verify-otp` |
| `password-reset` | email + address | 3 / h | false | Reset request |
| `refresh` | session | 60 / h | false | `POST /auth/refresh` |
| `member-api` | account | 600 / min | true | Member reads |
| `admin-api` | account | 1200 / min | true | Staff reads |
| `write-heavy` | account | 60 / min | false | Member writes, uploads |

### Four rules that make or break this

1. **Both directions on sign-in** (SC-013). Per-address alone is defeated by a botnet spraying one account; per-account alone lets one address enumerate the member base and is itself an account-lockout weapon. Both buckets are checked independently.
2. **`trustProxy` is load-bearing** (FR-040). Behind a CDN, every request arrives from the proxy's address, so a naive per-address limit treats the whole internet as one client — blocking everyone or nobody. Set to the known proxy hop count; setting it to `true` blindly lets a client forge `X-Forwarded-For` and bypass every limit. Production boot fails if it is unset.
3. **Public reads are not throttled into invisibility** (SC-014). A 429 to a crawler directly undermines the partner visibility the club has sold. `public-read` is generous and verified crawlers are allow-listed. This is the one place two of this feature's goals genuinely conflict, and SEO wins.
4. **Store failure is decided per bucket, never inherited.** Fail open where availability matters more than the limit; fail closed on every credential path, where an unmeasurable limit is no limit at all.

### Response on refusal (FR-042)

```
HTTP/1.1 429 Too Many Requests
Retry-After: 43
RateLimit-Limit: 10          RateLimit-Remaining: 0          RateLimit-Reset: 43
Content-Type: application/problem+json
```

### Business quotas are not rate limits (FR-043)

| Business rule | Source | Home |
|---|---|---|
| Invitation quota + cooldown | §3.1 | PostgreSQL, transactional |
| Coupon daily counters (global + per category) | §5 | PostgreSQL, `FOR UPDATE` |
| Event capacity across all sources | §4 | PostgreSQL, transactional |
| Newsletter / mass-message batch pacing | §9, §12.8 | Job scheduler + database |

These are correctness-critical, must survive a Redis flush, must be auditable, and must be reportable to staff — none of which a transport limiter offers. Conflating them is how a member exceeds their invitation quota by racing two requests.

---

## 4. Load shedding and shutdown

**Shedding**: `@fastify/under-pressure` with `maxEventLoopDelay: 1000`, `maxHeapUsedBytes`, `maxRssBytes`, returning 503 + `Retry-After`. Health routes are exempt, or a struggling instance would be killed rather than drained.

**Shutdown** (FR-046), `close-with-grace`, in order:

1. `SIGTERM` received.
2. **Readiness fails immediately** — the load balancer stops sending new work.
3. Stop accepting new connections.
4. In-flight requests get 15 s.
5. `forceCloseConnections: 'idle'` closes keep-alive sockets, so the process is not held for the full 72 s.
6. Drain the `pg` pool, close Redis, exit 0.

Step 2 must precede step 3, not accompany it: a balancer that still believes the instance is ready will keep routing work into a process that has stopped accepting it, and those requests fail for no reason.

---

## 5. Test contract

| Suite | Asserts | Criterion |
|---|---|---|
| `timeouts.test.js` | Budget honoured within 10% under an induced hang; work is cancelled, not merely abandoned | SC-009 |
| `isolation.test.js` | With one dependency hung, unrelated p99 moves < 20% | SC-010 |
| `breaker.test.js` | closed → open → half-open → closed; zero calls reach the dependency while open | SC-011 |
| `breaker-errorfilter.test.js` | A declined payment leaves the circuit **closed** | SC-012 |
| `rate-limit.test.js` | Both sign-in directions refused; headers present | SC-013 |
| `crawler-budget.test.js` | A normal-rate crawl over all public routes sees zero 429s | SC-014 |
| `trust-proxy.test.js` | Limits key on the forwarded address at the configured hop depth | FR-040 |
| `budget-assertion.test.js` | Startup fails when Σ outbound ≥ route deadline | FR-033 |
| `shutdown.test.js` | SIGTERM drops zero in-flight requests; readiness fails first | SC-015 |
| `client-abort.test.js` | Client disconnect cancels in-flight work | FR-034 |
