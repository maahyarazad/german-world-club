# Phase 0 Research: Server Platform Foundation

**Feature**: `002-server-platform` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

*Amended 2026-09-15: R23 added after Constitution v1.0.0 Principle VI made server-side media shaping non-negotiable.*

All unknowns from the plan's Technical Context are resolved below. Findings marked **verified in this environment** were checked against the installed toolchain (Node v22.23.2, npm 10.9.8, Fastify 5.12.3) rather than recalled.

---

## R1 — Repository structure: npm workspaces

**Decision**: Convert the repository root into an npm workspace with `server/` and the existing `client/` as members, plus `packages/contracts/` for validation schemas and shared constants. `server.js` at the root is retired and replaced by `server/src/app.js` (the composable Fastify instance) and `server/src/server.js` (the process entry point that starts it).

**Rationale**: §12.15 makes "one rule set, three clients" a business rule. A shared `packages/contracts` package is the structural form of that rule — request/response schemas live in one place and are imported by the API and by every client, so a client physically cannot validate differently. The business description also commits to two further clients (React Native mobile, staff admin console), so a flat single-package root would have to be restructured later anyway; doing it now costs one commit while the tree is small.

Splitting `app.js` from `server.js` is what makes the whole plan testable: `app.js` returns a built instance with no listening socket, so `fastify.inject()` drives every contract test in-process without ports, and the top-level `await` in `server.js` never runs during tests.

**Alternatives considered**:
- *Keep the flat root with `server.js`* — cheapest now, but there is nowhere for shared contracts to live, so mobile and admin would each re-declare validation and drift, which is the specific legacy defect §1.1 calls out.
- *Turborepo / Nx* — real build-orchestration value at larger scale; premature for two packages and adds a toolchain to learn for no current benefit.
- *pnpm workspaces* — better hoisting discipline, but npm is already in use with a committed lockfile; switching package managers is a separate decision from adding a workspace.

---

## R2 — Token architecture: short-lived JWT access token + opaque rotating refresh token

**Decision**: Two credentials per session.

| | Access token | Refresh token |
|---|---|---|
| Format | Signed JWT (EdDSA/Ed25519) | Opaque 256-bit random value |
| Lifetime | 10 minutes | 30 days (web), 90 days (mobile) |
| Stored server-side | No | Yes — SHA-256 hash only |
| Claims / payload | `sub`, `sid`, `aud`, `typ`, `iat`, `exp`, `jti` | none — it is a lookup key |
| Revocable immediately | Via `sid` denylist (see R3) | Yes, by deletion |
| Rotation | n/a | Single-use; rotated on every refresh |

Refresh is single-use with **reuse detection**: presenting a refresh token that has already been consumed terminates the whole session lineage and writes a security audit record (FR-005). This is the standard defence against a stolen refresh token, and it is also what makes §12.7's single-active-session rule enforceable.

Single active session (FR-004) is enforced in PostgreSQL, not in application logic:

```sql
CREATE UNIQUE INDEX one_active_session_per_account
  ON sessions (account_id, account_kind) WHERE revoked_at IS NULL;
```

A partial unique index makes two concurrent sign-ins a database error rather than a race, which is what §1.2 means by "relational integrity is load-bearing".

**Rationale**: The business description asks for two things that are in direct tension — JWT-based access (stateless, fast, no database hit per request) and single-active-session with immediate staff-permission revocation (inherently stateful). Splitting the credentials resolves it: the JWT stays stateless and cheap for the 10-minute window, and all revocation power lives in the server-side refresh record. The residual exposure is bounded and explicit: **a revoked session's access token remains cryptographically valid for at most 10 minutes.** R3 states where that window is not acceptable and what is done about it.

EdDSA over HS256 because the mobile app and admin console will eventually verify tokens they did not mint; a public verification key means no shared secret has to be distributed to anything that only needs to read tokens.

**Alternatives considered**:
- *Long-lived stateless JWT only* — no server state, but cannot satisfy FR-004 or FR-006 at all. Rejected on requirements, not preference.
- *Server-side sessions only, no JWT* — simplest correct model, and genuinely defensible; rejected because the user explicitly asked for JWT and because mobile clients (§6.2) are better served by bearer tokens than by cookies.
- *Access token lifetime of 60 minutes* — fewer refreshes, but stretches the revocation window to an hour, which is too long for a console that can move money.
- *Storing refresh tokens in plaintext* — rejected; a database read leak would then be a full session-hijack leak.

---

## R3 — Authorization state is never read from the token

**Decision**: The access token carries **identity only** — who the principal is, which session, and which audience. It carries no permission flags, no role matrix, and no membership entitlement. Every authorization decision reads server-held state at request time, through a small cache:

- **Permission snapshot cache**: keyed by admin account id, TTL 30 s, and **explicitly invalidated on write** whenever a superadmin changes a permission or an account's status. The TTL is the backstop, not the mechanism.
- **Session revocation denylist**: `sid` values revoked within the last 10 minutes, held in Redis. Checked on every request. Because entries expire with the access-token lifetime, this set stays small.
- **Membership entitlement**: resolved at point of use from the card's validity window, never cached across a request.

**Rationale**: Three separate business rules make token-embedded authorization wrong here, not merely suboptimal:

1. §11's five-flag matrix is staff-editable at any moment, and FR-006/SC-003 require a revocation to bite on the *next request*. Claims baked at sign-in cannot do that.
2. §11's rule that "lower-privileged staff can never edit admin/superadmin accounts" is a rule about the **target object**, not about the caller's module flags — it cannot be expressed as a claim at all (see R4).
3. §12.2 makes event discounting entitlement-driven, and a membership card can lapse mid-session. A `package: 3` claim would keep granting free events after the card expired — a revenue defect, and exactly the kind of client/server divergence §12.15 exists to prevent.

The cost is one cache read per request and a database read every 30 s per active staff account. For a club-scale admin console that is negligible; the correctness it buys is not.

**Alternatives considered**:
- *Permissions as JWT claims with a 10-minute window* — one less lookup per request, but SC-003 fails by up to 10 minutes on a permission revocation. For an account-management console that is the wrong trade.
- *No cache, read permissions per request* — simpler and correct; the 30 s cache exists only to keep the hot path off the database, and its explicit invalidation means it is not a correctness compromise.

---

## R4 — RBAC enforcement: two layers plus a deny-by-default route registry

**Decision**: Authorization is enforced at two distinct layers, because the business rules are of two distinct kinds.

**Layer 1 — module capability** (declarative, per route):

```js
app.get('/admin/members', {
  config: { auth: { audience: 'staff', module: 'members', flag: 'read' } }
}, handler)
```

A single `preHandler` resolves the principal, loads the permission snapshot, and allows the request if the principal is a superadmin (FR-008) or holds the named flag on the named module (FR-007).

**Layer 2 — object guard** (imperative, inside the handler): rules that depend on the *target* of the operation, which no route-level declaration can express. The load-bearing one is FR-009: a department admin with full `edit` on the `admins` module must still be refused when the row they are editing is itself an admin or superadmin. This is checked against the loaded target row, inside the transaction, before any mutation.

**Deny-by-default registry** (FR-001, SC-001): an `onRoute` hook records every registered route and its declared `config.auth`. An `onReady` hook fails startup — loudly, with the offending method and path — if any route declared none. A route is made public by declaring `{ auth: { audience: 'public' } }`, never by silence.

**Rationale**: §10.1's own wording — "silence is not an acceptable default in either direction" — is written about crawl posture, but the same discipline is what prevents the classic authorization defect: a route added in a hurry that nobody remembers to guard. Making it a startup failure rather than a review checklist means the failure is impossible to merge, and it is the cheapest possible implementation of SC-001.

Separating the two layers matters because collapsing them is how FR-009 gets lost. A reviewer reading only route declarations would see `module: 'admins', flag: 'edit'` and conclude the route is correctly guarded, while the privilege-escalation path is still open.

**Alternatives considered**:
- *A single role enum (`member` / `admin` / `superadmin`)* — explicitly rejected by §11, which says the five-flag matrix "should be preserved as-is". A role enum cannot express "read but not delete on events".
- *A policy engine (Casbin, OPA)* — genuinely expressive, and worth revisiting if rules multiply; rejected now because the entire rule set is two flags plus a 5×N matrix plus one object guard, which is ~80 lines of plain code and far easier to test exhaustively than a policy DSL.
- *Guarding in every handler with no route declaration* — no startup check is then possible, and SC-001 becomes unverifiable.

---

## R5 — Password hashing: argon2id, with forced reset for legacy accounts

**Decision**: `argon2` (0.45.1) using argon2id, 19 MiB memory cost, 2 iterations, parallelism 1 — the OWASP baseline. The stored hash is self-describing, so parameters can be raised later and hashes upgraded transparently on next successful sign-in.

For legacy data: **unsalted MD5 values are never verified.** Imported accounts are created with no usable password and a forced-reset flag; the member completes a password reset to activate (FR-014).

**Rationale**: §1.2 is unusually explicit that legacy MD5 "was never an intended business rule and must be replaced". The tempting migration — verify the MD5 once at next sign-in, then re-hash with argon2 — is rejected because unsalted MD5 of a human-chosen password is recoverable in bulk, so those hashes must be treated as already-public plaintext. Accepting one as proof of identity would authenticate an attacker who has the dump. A forced reset costs every migrated member one email; accepting MD5 costs the club its account base.

This also composes with §3.2, which already routes Inactive members through a password reset to reactivate — so the reset path is a flow the business has anyway, not one invented for the migration.

**Alternatives considered**:
- *bcrypt* — fine, widely deployed, but capped at 72 bytes and not memory-hard. No reason to prefer it for a greenfield store.
- *scrypt (Node built-in, zero dependencies)* — a real contender; argon2id chosen for its explicit side-channel-resistant variant and clearer parameter guidance.
- *Verify-once-then-upgrade MD5* — rejected above on security grounds.

---

## R6 — Transport differs per client, rules do not

**Decision**: The same token model (R2) is carried differently per face, exactly as §6.2 permits:

| Face | Access token | Refresh token | CSRF |
|---|---|---|---|
| Member web + admin console | `HttpOnly`, `Secure`, `SameSite=Lax` cookie | `HttpOnly`, `Secure`, `SameSite=Strict` cookie, scoped to the refresh path | Required — double-submit token via `@fastify/csrf-protection` |
| Mobile | `Authorization: Bearer` header | in device secure storage | Not applicable — no ambient credentials |

`@fastify/jwt` reads from either location (its `cookie` option), so one `jwtVerify` serves both and there is no second code path to keep in sync.

**Rationale**: Cookies keep the web token out of reach of JavaScript, which is the right default for a browser; bearer headers avoid cookie semantics that mobile does not want. Because the *mechanism* differs but the verification, session lookup, and permission resolution are shared, §12.15 holds: a mobile client cannot end up with different entitlements than the web client for the same account.

CSRF protection is mandatory the moment credentials become ambient. `SameSite=Lax` alone is a mitigation, not a defence — it does not protect against a same-site subdomain, and the club serves multiple subdomains today.

**Alternatives considered**:
- *Bearer tokens in `localStorage` for web too* — one code path, no CSRF concern, but any XSS becomes full account takeover. Rejected.
- *`SameSite=Strict` on the access cookie* — breaks arriving at a gated page from an external link (an invitation email, for instance), which §3.1 depends on. `Strict` is kept for the refresh cookie, where no cross-site entry point is legitimate.

---

## R7 — Request timeouts: four layers, with a budget rule

**Verified in this environment**: `new Fastify().server.requestTimeout` is **`0` — disabled by default**, while `headersTimeout` is 60 s and `keepAliveTimeout` is 72 s. So the server as it stands today will hold a stalled request open indefinitely. This is not a hardening nicety; it is an unbounded resource leak in the delivered code.

**Decision**: four distinct layers, because no single setting covers the cases.

| Layer | Mechanism | Value | Covers |
|---|---|---|---|
| 1. Socket | `requestTimeout` | 30 s | A client that never finishes sending. Node answers 408 and closes. |
| 2. Connection | `connectionTimeout` | 35 s | Idle sockets; also the prerequisite for the `onTimeout` hook to fire at all. |
| 3. Handler deadline | `AbortSignal.timeout(budget)` per route, combined with the client-disconnect signal via `AbortSignal.any()` | 2–10 s by route class | A handler blocked on a slow query or dependency. |
| 4. Outbound | `undici` `headersTimeout` / `bodyTimeout`; `pg` `statement_timeout` | per dependency, see R8 | A dependency that accepts the connection and then stalls. |

**Verified**: `AbortSignal.timeout` and `AbortSignal.any` are both available on Node 22.23.2, so layer 3 needs no dependency.

**The budget rule** (FR-033): for any route, the sum of the outbound budgets it may incur must be **strictly less** than its own handler deadline, which must be less than `requestTimeout`. Violating this inverts the failure: the caller gives up first, retries, and the retry arrives while the original is still running — the standard way a slow dependency becomes an outage. The rule is enforced by a startup assertion over the route budget table, not by review.

Two nuances that are easy to get wrong:
- **`onTimeout` cannot respond.** Fastify's own documentation is explicit that the socket is already hung up; it is a place to record a metric, not to send an error body. The error the client sees comes from layer 1 or 3.
- **`keepAliveTimeout` must exceed the proxy's idle timeout**, or the proxy will reuse a socket the server is closing and surface sporadic 502s. Fastify's 72 s default is already chosen for this; it is documented as a deployment precondition rather than lowered.
- `forceCloseConnections: 'idle'` is set explicitly so graceful shutdown (R21) can actually complete.

**Also noted**: Fastify 5.12 deprecates the top-level `disableRequestLogging` option in favour of `logController` with `disableRequestLogging` / `isLogDisabled`. The new form is used from the start so this does not become a Fastify 6 migration chore.

**Alternatives considered**:
- *`requestTimeout` alone* — covers only a slow client, which is the least likely of the four failure modes. Leaves a slow dependency unbounded.
- *A global `setTimeout` race per handler* — works, but leaks the timer and cannot cancel the underlying query, so the connection stays busy after the client is answered. `AbortSignal` propagates cancellation to `pg` and `undici` for real.
- *Per-route timeouts only, no socket timeout* — a client that stops mid-body never reaches a handler, so no handler timeout can fire.

---

## R8 — Circuit breaking: `opossum` outbound, `under-pressure` inbound

**Decision**: Two mechanisms for two different jobs, because "circuit breaker" is routinely used for both.

**Outbound — `opossum` (10.0.0), one breaker instance per dependency.** Each dependency declares a full policy:

| Dependency | Timeout | Threshold | Reset | Unavailable behaviour | Retry safe? |
|---|---|---|---|---|---|
| Payments (WorldPay) | 8 s | 50% / 10 req | 60 s | **Fail closed** — explicit failure, never record success | No — unless carrying the idempotency reference (§12.5) |
| SMS / OTP | 5 s | 50% / 20 req | 30 s | Refuse sign-in with a retry-later message | Yes, same code within its validity window |
| SMTP / mail | 10 s | 60% / 20 req | 60 s | Enqueue for later delivery | Yes — queue is idempotent by message id |
| Geocoding | 3 s | 50% / 10 req | 120 s | Save the record without coordinates; backfill later | Yes |
| Redis (limits, denylist) | 250 ms | 50% / 50 req | 10 s | Per-route-class policy — see R9 | Yes |

**`errorFilter` is the load-bearing detail** (FR-036): a declined card, an invalid phone number, or a 4xx of any kind is a **business outcome**, not a dependency failure, and must not count toward the threshold. Without this filter a busy evening of legitimately declined cards trips the payment breaker and takes payments down for everyone — a self-inflicted outage caused by the protection itself. Only timeouts, connection errors, and 5xx responses count.

**Fail-closed on payments** is a business rule, not a default (FR-037): a breaker's usual kindness is a fallback value, and a fallback that lets checkout proceed would hand out membership cards and event seats for free.

**Inbound — `@fastify/under-pressure` (9.1.0)**: sheds load with 503 + `Retry-After` when event-loop delay or heap exceeds thresholds, and backs the readiness endpoint (FR-045, FR-050). This is the correct tool for self-protection; a per-route breaker is not.

**`@fastify/circuit-breaker` (4.0.3) is deliberately not used.** It breaks *inbound* routes by error rate, which duplicates `under-pressure` for self-protection and does nothing for the outbound dependency isolation this feature actually needs.

**Alternatives considered**:
- *`cockatiel`* — a strong, well-typed resilience library covering retry, breaker, bulkhead, and timeout in one policy pipeline; a reasonable choice. `opossum` chosen for its maturity, its first-class `errorFilter` and `fallback`, and its built-in stats/event surface, which feeds R17 without extra wiring.
- *Hand-rolled breaker* — ~60 lines, no dependency, but half-open probing and rolling windows are easy to get subtly wrong and the failure mode is invisible until an incident.
- *Retry without a breaker* — amplifies load against a struggling dependency; the combination is only safe when the breaker is there to stop the retries.

---

## R9 — Rate limiting: named buckets across independent dimensions

**Decision**: `@fastify/rate-limit` (11.2.0) with a Redis store, configured as a table of **named buckets** rather than one global limit. Transport limits are deliberately distinguished from business quotas.

| Bucket | Dimension | Allowance | Store failure |
|---|---|---|---|
| `public-read` | client address | 300 / min | **Fail open** — a limiter outage must not take the public site down |
| `sign-in-ip` | client address | 10 / 15 min | **Fail closed** |
| `sign-in-account` | account identifier | 5 / 15 min | **Fail closed** |
| `otp-send` | phone number | 3 / hour, 60 s cooldown | **Fail closed** |
| `otp-verify` | session | 5 attempts, then invalidate the code | **Fail closed** |
| `password-reset` | email + address | 3 / hour | **Fail closed** |
| `member-api` | account | 600 / min | Fail open |
| `admin-api` | account | 1200 / min | Fail open |
| `write-heavy` | account | 60 / min | Fail closed |

Four points that make or break this:

1. **Both directions on sign-in** (FR-039, SC-013). Per-address alone is defeated by a botnet spraying one account; per-account alone lets one address enumerate the member base, and is itself an account-lockout weapon. Both buckets are required, and they are checked independently.
2. **`trustProxy` is load-bearing** (FR-040). Behind a CDN or load balancer, every request arrives from the proxy's address, so a naive per-address limit treats the entire internet as one client — the limit either blocks everyone or nobody. `trustProxy` is configured to the known proxy hop count; setting it to `true` blindly would let a client forge `X-Forwarded-For` and bypass every limit. The correct value is a deployment input, and startup refuses to run in production without it set.
3. **Public reads must not be throttled into invisibility** (FR-041, SC-014). A rate limit that returns 429 to a crawler directly undermines User Story 2 and the partner visibility the club has sold. `public-read` is generous, is measured, and verified crawler traffic is allow-listed. This is the concrete point where two of this feature's goals pull against each other, and SEO wins.
4. **Store-failure behaviour is set per bucket, never inherited** (FR-044). `@fastify/rate-limit`'s `skipOnError` is exactly this switch, and it is set explicitly on every bucket — fail open where availability matters more than the limit, fail closed on every credential path, where an unmeasurable limit is no limit.

**Business quotas are not rate limits** (FR-043). Invitation quotas and cooldowns (§3.1), coupon daily counters (§5), event capacity across sources (§4), and newsletter batch pacing (§9) all live in PostgreSQL under transactions and row locks. They are correctness-critical, must survive a Redis flush, must be auditable, and must be reportable to staff — none of which a transport limiter offers. Conflating them is the mistake that lets a member exceed their invitation quota by racing two requests.

**Alternatives considered**:
- *One global limit* — trivially either too tight for crawlers or too loose for credential endpoints, because these differ by two orders of magnitude.
- *In-memory store* — the default, and silently wrong with more than one instance: an N-instance deployment grants N× every limit. Acceptable in development only, and the difference is documented rather than hidden.
- *Limiting at the CDN / WAF edge* — genuinely better for volumetric floods and worth having as well; it cannot see account identity, so per-account buckets must exist in the application regardless.

---

## R10 — Public rendering: route-owned templates now, React SSR when a public page needs interactivity

**Decision**: Public pages are rendered **server-side by Fastify** from the content record, using a small template layer with no client framework in the initial response path. The gated portal and admin console stay client-rendered Vite bundles (§10.1 never indexes them, so they gain nothing from SSR).

Staging:
- **Stage 1 (this feature)**: Fastify routes own the public HTML for the page types that exist or are imminent — coming-soon/landing, partner listing and outlet, public event page, magazine article, committee/legal. Each route resolves its content record, passes it to one `buildPageMeta()` function (R11), and renders a template. The feature-001 coming-soon page already satisfies FR-016 through its pre-rendered boot shell and is served as-is.
- **Stage 2 (later feature, not here)**: if a public page needs real interactivity, that route adopts React SSR with hydration. The metadata contract does not change, because it was never coupled to the renderer.

**Rationale**: §10.2 sets the requirement as *meaningful content in the initial response* and explicitly leaves the mechanism open. Full React SSR is the heaviest way to satisfy it and brings a hydration story, a streaming story, and a two-runtime build to a set of pages that are almost entirely read-only content. Server-rendered templates satisfy the requirement outright, with far less machinery and better Core Web Vitals (§10.9) since there is no bundle to hydrate.

The decisive constraint is stated in §10.2 itself: link-preview bots do not execute JavaScript at all. A share of an event page must produce a correct card from the HTML bytes alone, and that is a rendering decision, not a metadata decision.

**Alternatives considered**:
- *React SSR for everything now* — one component language across public and gated surfaces, which has real appeal; rejected as disproportionate for read-mostly pages and because it puts the club's monetized partner pages behind the most complex delivery path available.
- *Build-time prerender of all public pages* — excellent CWV, but partner and event pages change with contract state and registration state (§10.4, §10.5), and a stale build would publish exactly the false availability §10.4 forbids.
- *Client-rendered with dynamic meta injection* — defeats §10.2 for the non-JS crawlers that matter most.

---

## R11 — One metadata source of truth: `buildPageMeta()`

**Decision**: A single pure function is the only way page metadata is produced:

```
buildPageMeta(record, context) -> {
  title, description, canonical, robots,
  og:{ type, title, description, image:{url,width,height,alt}, url, siteName, locale },
  twitter:{ card, title, description, image },
  alternates: [{ hreflang, href }],
  jsonLd: [ ...structured data documents ],
  lastModified
}
```

Rules it enforces internally, so no caller can forget them:
- Staff-editable SEO fields override derived values (FR-020); derived values are the fallback, never the other way round.
- Descriptions are truncated at a word boundary to a sane length; titles are suffixed with the site name once and only once.
- Image URLs are absolutized against the single canonical origin, and `width`, `height`, and `alt` are **required** — a share image without dimensions is treated as a validation failure at test time, not silently emitted (FR-018).
- `robots` is derived from the record's indexable flag **and** the surface's posture from §10.1, with the stricter of the two winning.
- Everything interpolated into HTML is escaped; a partner-supplied business name containing a quote must not be able to break out of a `content` attribute.

**Rationale**: §10.3 names the failure mode precisely — "hand-maintained metadata that duplicates on-page copy drifts and is a recurring defect source". A pure function taking the same record the page body renders from makes drift structurally impossible rather than a review item. It is also trivially unit-testable: uniqueness (SC-006) becomes a property test over a set of records, with no server and no browser.

This function is also the concrete answer to the requested "OG tag handlers": the handler is not per-route hand-written tags, it is one resolver plus one serializer, with per-route input.

**Alternatives considered**:
- *A metadata table maintained by staff for every page* — maximum control, but that is the drift §10.3 warns about, and it scales linearly with content.
- *Per-route inline tag construction* — how the current `client/index.html` does it, and fine for exactly one page; guarantees divergence across dozens of partner pages.

---

## R12 — Eliminating the soft-404, and canonical redirects

**Decision**: Replace the current catch-all. Today's `server.js` does this:

```js
app.setNotFoundHandler((req, reply) => {
  if (req.raw.url?.startsWith('/api')) { reply.code(404).send({error:'Not found'}); return }
  reply.sendFile('index.html')            // ← HTTP 200 for every unknown path
})
```

Every unknown path — `/nonsense`, `/wp-login.php`, `/partners/deleted-partner` — returns the application shell with a success status. That is precisely the defect §10.6 and §12.13 describe: unlimited duplicate indexable URLs, and the reason a crawler cannot tell a real page from a typo.

The replacement:
- `@fastify/static` is registered with `wildcard: false`, so it serves only files that exist.
- The not-found handler returns **404** with a rendered, non-indexable error page for HTML requests and a problem+json document for API requests (R16).
- The SPA shell is served only at its own declared routes, never as a fallback.
- **Canonical origin** (FR-028): an `onRequest` hook 301s any request whose host or scheme is not canonical, before routing. One host, one scheme, one trailing-slash convention, lowercase paths.
- **Legacy redirects** (FR-029): a data-driven table of legacy path → new path, served as 301. The mechanism and its tests ship in this feature; the table is populated when the club supplies its legacy URL inventory.
- A regression test asserts 404 for a fixture list of at least 50 known-bad paths (SC-004), so this defect cannot return.

**Rationale**: §12.13 states the rule as "missing means missing" and §10.6 calls it "a real, easily-introduced defect in single-page application delivery — it must be explicitly prevented and regression-tested". The business description effectively pre-wrote the acceptance test; this is the only finding in this research that fixes a defect already shipped rather than preventing a future one.

**Alternatives considered**:
- *Keep the catch-all but add `X-Robots-Tag: noindex`* — the status code is still 200, so the URL remains a valid duplicate to every consumer that ignores the header, and link-shares still resolve. Treats the symptom.
- *Serve the shell at 404* — better than 200, but the shell then renders "page not found" only after JS executes, which is invisible to preview bots.

---

## R13 — Sitemap and robots generated from live state

**Decision**: `GET /sitemap.xml` is generated from a database query over published, indexable content, never hand-maintained (FR-023). `lastmod` comes from each record's real `updated_at`. Cached for 1 hour with an explicit invalidation on publish/unpublish. A sitemap index is introduced if the URL count passes 10,000 — noted as the trigger, not built now.

Inclusion is a single predicate: published **and** indexable **and** (for partners) `contract_end + grace >= now`. A lapsed partner leaves the sitemap automatically (SC-008), because the query is the source of truth rather than a staff action.

`GET /robots.txt` is generated from the same §10.1 surface table that drives route postures, so a new gated surface is disallowed by construction rather than by remembering to edit a static file. It points at the sitemap.

**Expired-partner handling** (FR-031) is an explicit configured choice per the business's decision, with `410 Gone`, `301` to the partner category, or a retained non-indexed page all supported. The default is a retained non-indexed page — it preserves any inbound links a paying partner earned while keeping the club's word to stop advertising the listing — and it is recorded as a decision the club can change, which is what §10.5 asks for.

**Rationale**: §10.5 requires entries to "appear when content is published and disappear when it is unpublished, expires, or (for partners) when the listing contract lapses". Any hand-maintained artefact fails this on the first missed edit, and a partner still listed after their contract lapsed is, as §10.4 puts it, "a factual misstatement to members".

The static `client/public/robots.txt` and `client/public/sitemap.xml` from feature 001 are superseded and removed, so there is exactly one source.

---

## R14 — Structured data generated from live state

**Decision**: JSON-LD emitted per content type, built by the same resolver that builds metadata (R11), from the same record:

| Type | Surface | State that must stay live |
|---|---|---|
| `Organization` | every public page | — |
| `LocalBusiness` | partner listing and each outlet | active only while in contract |
| `Event` | public event page | `eventStatus` and `offers.availability` from real registration state |
| `Article` | magazine and news | `datePublished`, `dateModified` |
| `BreadcrumbList` | nested content | — |

Each document is validated against its shape in tests (SC-007), and the availability-matches-state assertion is a test, not a convention.

**Rationale**: §10.4 is unambiguous: "publishing an `Event` as available after registration has closed, or a partner as active after their contract lapsed, is both an SEO penalty and a factual misstatement to members." Generating from live state at request time is the only way to keep that promise; any denormalised copy is a stale copy waiting to happen. Deriving it in the same function as the meta tags means one record read produces both, and they cannot disagree.

---

## R15 — Language and regional targeting

**Decision**: German is the default locale; English is secondary. Each public page declares `<html lang>`, and where a translation exists both versions emit reciprocal `hreflang` links plus `x-default` pointing at the German version (FR-030). Regional relevance comes from `LocalBusiness` address and geo data in structured data (R14), not from separate country sites.

**Rationale**: §10.7 specifies exactly this, including the explicit rejection of separate country sites. The failure mode it guards against is two translations competing as duplicates, which suppresses both. Reciprocity is the part that is easy to get wrong — a one-directional `hreflang` is ignored — so the alternates list is generated from the translation-group record rather than written per page.

---

## R16 — One error envelope: RFC 9457 problem+json

**Decision**: Every error response, from every route, uses `application/problem+json`:

```json
{ "type": "https://german-emirates-club.com/problems/insufficient-permission",
  "title": "Insufficient permission",
  "status": 403,
  "detail": "Requires 'edit' on module 'members'.",
  "instance": "/admin/members/42",
  "requestId": "01JC2K..." }
```

Set via `setErrorHandler` and `setNotFoundHandler`, with `@fastify/sensible` for the standard error constructors. HTML-accepting requests get a rendered error page instead, at the same status. `detail` never leaks internals: a failed database query is "an internal error occurred" plus the `requestId`, with the real cause in the logs only.

**Rationale**: §12.15 — one rule set, three clients — extends to failures. If the web client parses `{error}` and mobile parses `{message}`, error handling diverges immediately and the divergence surfaces as inconsistent user-facing behaviour, which is the drift §1.1 describes. Standardising on RFC 9457 means the shared contracts package (R1) can export one error type every client imports. Returning `requestId` to the caller is what makes a support report traceable (FR-047).

---

## R17 — Observability: correlated, redacted structured logs

**Decision**: `pino` (10.3.1, Fastify's built-in logger) with:
- **Correlation**: `genReqId` produces a ULID per request, echoed as `X-Request-Id` and included in every error envelope. `@fastify/request-context` carries it into non-request code paths so a log line from inside a dependency call is still attributable.
- **Redaction**: an explicit `redact` path list covering `authorization`, `cookie`, `set-cookie`, `password`, `token`, `refreshToken`, `otp`, `email`, `mobile`, `body.billing.*`. A test asserts a sign-in request produces no log line matching any credential pattern (SC-016).
- **Audit trail**: a separate append-only `audit_log` table, not the application log, for sign-ins, denials, permission changes, session terminations, and refresh replay (FR-015). Logs rotate and are for operators; audit records are business evidence and must not.
- **Breaker and limiter events** surfaced as metrics: circuit state transitions, rate-limit refusals per bucket, timeouts per route class.
- **Job runs** written to `job_runs` (FR-051), which §11 already requires as admin-managed entities with logged runs.

**Rationale**: FR-048 is a data-protection requirement, not tidiness — the club holds member PII (§10.1) and the legacy system's own note about PII gating makes the sensitivity explicit. Redaction is configured as an allowlist-shaped `redact` list at logger construction so it applies to code not yet written; adding it per log call would fail on the first forgotten call site.

The distinction between application logs and the audit table matters: FR-015's denial records must survive log rotation and be queryable by staff, which a log aggregator is the wrong home for.

---

## R18 — Data access: `pg` with SQL migrations

**Decision**: `pg` (8.23.0) with a thin typed query layer and plain SQL migration files applied by a small runner, checked into `server/migrations/`. Per-connection `statement_timeout` set to sit just inside the handler deadline (R7 layer 4). Transactions used for every multi-step mutation; `SELECT … FOR UPDATE` or advisory locks for counters.

This feature's schema is only the platform layer — `members` (identity and status columns only), `admin_users`, `admin_permissions`, `sessions`, `refresh_tokens`, `audit_log`, `job_runs`, `seo_metadata`, `legacy_redirects`. Domain tables belong to their own features.

**Rationale**: §1.2 states that invitation quotas, event capacity, card validity windows, and redemption counters "belong in PostgreSQL constraints and transactions rather than in application-level checks". That argues for keeping SQL visible rather than behind an abstraction that makes partial indexes, exclusion constraints, and `FOR UPDATE` awkward — the partial unique index in R2 is a good example of a constraint that is natural in SQL and fiddly through an ORM.

**Alternatives considered**:
- *Drizzle (0.45.2)* — genuinely good, keeps SQL semantics visible, gives type inference and migration generation; the strongest alternative and a reasonable reversal if hand-written SQL becomes a drag. Rejected now to keep the foundation dependency-light while the schema is small and constraint-heavy.
- *Prisma* — best-in-class DX, but its migration engine and query builder make PostgreSQL-specific constraints harder to express, which conflicts with §1.2's core premise.
- *Knex* — a query builder without the type story; little advantage over `pg` plus SQL here.

---

## R19 — Validation and shared contracts

**Decision**: Zod (4.6.5) schemas in `packages/contracts/`, bridged into Fastify's route schemas by `fastify-type-provider-zod` (7.0.0) so one schema yields request validation, response serialization, and OpenAPI output via `@fastify/swagger` (9.8.1). Clients import the same schemas.

**Rationale**: This is the mechanism behind §12.15. When a member web form, a React Native screen, and the admin console all import the same schema, a validation rule cannot be implemented twice and drift — which §1.1 names as the legacy system's "most persistent defects". Generating OpenAPI from the same source keeps documentation from becoming a third, separately-wrong description.

Response *serialization* schemas do double duty as a privacy control: a route that serializes through an explicit schema cannot accidentally leak a column added to a table later, which matters directly for §10.1's member-PII boundary.

**Alternatives considered**:
- *Raw JSON Schema with Fastify's native AJV* — no dependency, fastest possible validation, and Fastify's first-class path; rejected because JSON Schema is not ergonomic to share with clients and gives no inference.
- *TypeBox* — closer to Fastify's grain and lighter than Zod; a good choice if the stack later goes TypeScript-first. Zod chosen for client-side ergonomics and its transform/refinement model, which suits cross-client form validation.

---

## R20 — Testing strategy

**Decision**: Vitest (already at 5.0.0 in `client/`) for the server too, driving `fastify.inject()` against the built app — no listening port, no HTTP client. Layers:

| Layer | What it proves |
|---|---|
| Unit | `buildPageMeta`, permission resolution, budget arithmetic, sitemap predicate |
| Contract | Every route against its Zod schema, both directions |
| **Authorization matrix** | Every route class × every principal kind; the table *is* the test (SC-002) |
| **Crawl posture** | Every §10.1 surface: status, `X-Robots-Tag`, robots.txt entry (SC-008) |
| **Soft-404** | A fixture list of ≥50 bad paths, all 404 (SC-004) |
| Resilience | Stub dependencies that hang, error, and recover; assert budgets, breaker transitions, `errorFilter` on 4xx (SC-009–SC-012) |
| Migration | Every migration applies and rolls back against a scratch database |

Postgres and Redis come from `testcontainers` where available, falling back to a documented local instance; no mocking of the database, since the constraints being relied on (R2, R18) only exist in the real engine.

**Rationale**: §10.10 asks for SEO to be "verifiable, not aspirational… checked automatically as part of the delivery pipeline, the same way accessibility and functional behaviour are". The crawl-posture and soft-404 suites are the direct implementation of that sentence. The authorization matrix is written as a data table so adding a route forces a row — the same deny-by-default discipline as R4, applied to tests.

---

## R21 — Load shedding and graceful shutdown

**Decision**: `@fastify/under-pressure` for shedding (R8). `close-with-grace` (2.5.0) for shutdown: on `SIGTERM`/`SIGINT`, stop accepting connections, fail readiness immediately so the load balancer drains, allow in-flight requests a 15 s budget, then close the pool and exit (FR-046). `forceCloseConnections: 'idle'` ensures keep-alive sockets do not hold the process open for the full 72 s `keepAliveTimeout`.

Readiness must fail *before* the drain begins, not with it — otherwise the balancer keeps routing new work into a process that has stopped accepting it, and those requests fail for no reason.

---

## R22 — Public-page caching and Core Web Vitals

**Decision**: `@fastify/etag` (6.2.0) plus explicit `Cache-Control` per surface — public content `public, max-age=300, stale-while-revalidate=86400`; sitemap 1 hour; gated responses `private, no-store`. `@fastify/compress` (9.2.0) for text. `@fastify/helmet` (13.1.1) for security headers with a CSP that permits the public templates' inline critical CSS via nonce.

Images (§10.9's named dominant weight) are served with explicit `width`/`height` attributes and modern formats, with dimensions stored on the asset record so the template can always emit them — unsized images being, as §10.9 notes, the most common cause of layout shift.

`no-store` on gated responses is a correctness requirement, not a performance one: a cached member profile served to a later visitor from a shared proxy is a PII breach, and it is the failure §10.1's gating exists to prevent.

---

## R23 — Media derivatives: `sharp` synchronous for images, `ffmpeg` queued for video

**Decision**: Uploads are validated by content inspection, stripped of metadata, and derived at ingest. Images are derived **synchronously inside the request**; video is derived **asynchronously through a `pg-boss` queue**. Storage is content-addressed behind a driver interface — S3-compatible in deployed environments, local disk in development.

| | Images | Video |
|---|---|---|
| Library | `sharp` 0.35.4 (libvips) | `ffmpeg` via `ffmpeg-static` 5.3.0, spawned directly |
| Timing | Synchronous, inside an 8 s `media-upload` budget | Queued; asset reports `processing` |
| Output | `thumb` 160 / `small` 400 / `medium` 800 / `large` 1600 px, WebP primary + alpha-aware fallback | WebM (VP9/Opus) + WebP poster |
| Dimensions recorded | Before the response returns | Before the response returns (probe only) |

**Rationale**: §10.9 already required images "served in appropriate sizes and formats with explicit dimensions", and Constitution Principle VI now prohibits serving an unoptimized original as a rendering path. The split is forced by arithmetic rather than preference: a 2 MB photograph through `sharp` is roughly 200–600 ms for the full variant set, which fits an 8 s budget, while a WebM transcode takes minutes and is CPU-bound — it fits no budget in R7 and holding the request open would violate FR-032. Probing dimensions synchronously in both cases is what keeps §10.9's layout-shift requirement satisfied even while a transcode is pending.

**WebP primary with an alpha-aware fallback**, rather than PNG as a delivery format: PNG for photographic content is typically 5–10× larger than WebP or JPEG, so defaulting to it would work against the entire purpose of the pipeline. PNG earns its place only where the source has transparency.

**`fluent-ffmpeg` is deliberately not used.** Its latest release (2.1.3) is effectively unmaintained, and a direct `node:child_process` spawn gives the hard-kill-at-budget control R7's rule requires. A subprocess also keeps a CPU-bound transcode off the event loop, so `@fastify/under-pressure` does not shed unrelated traffic while one runs.

**Validation order is load-bearing**, and step 4 is the one most often skipped: a 10 KB PNG can declare 100,000 × 100,000 pixels and decode to tens of gigabytes. The dimension bound is therefore read from the header *before* decode, and enforced again by `sharp`'s `limitInputPixels`. SVG is refused outright — it is a document that can carry script, and serving one from the club's origin is a stored-XSS primitive.

**Content-addressed storage** (SHA-256 of the bytes) gives three things at once: identical uploads store once, derivative URLs are immutable so they can be cached for a year, and a retry after a breaker recovery produces identical bytes at an identical key — which is what makes generation safe to retry.

**Alternatives considered**:
- *Client-side resizing before upload* — no server CPU cost, but it re-implements a server rule in three clients (Principle I), cannot strip EXIF before the bytes reach storage, and is trivially bypassed by a direct API call.
- *CDN-edge or on-the-fly resizing* (imgproxy, Cloudinary, Vercel image optimization) — genuinely good, and worth revisiting for scale; rejected as the primary mechanism because it keeps the unoptimized original as the stored source of truth, still requires server-side validation and EXIF stripping, and makes partner-page delivery depend on a third party whose visibility the club has sold.
- *Deriving everything asynchronously, including images* — more uniform, and a defensible simplification; rejected because it would make every upload return `processing` and force every client to poll for a case that comfortably fits the budget.
- *`jimp` (pure JS, no native dependency)* — avoids a binary build step, but is an order of magnitude slower and would not fit the synchronous budget.

---

## Resolved unknowns summary

| Unknown from Technical Context | Resolution |
|---|---|
| Repository layout for three clients + one API | R1 — npm workspaces, `packages/contracts` shared |
| JWT vs. single-active-session tension | R2 — short JWT + opaque rotating refresh, DB partial unique index |
| Where permission state is read from | R3 — server-side at request time, never from claims |
| How the five-flag matrix is enforced | R4 — two layers + deny-by-default route registry |
| Password hashing and legacy MD5 | R5 — argon2id; forced reset, never verify MD5 |
| Web vs mobile credential transport | R6 — cookies + CSRF / bearer, one verification path |
| Request timeout strategy | R7 — four layers, budget rule; `requestTimeout` is **0 by default** |
| Circuit breaker library and policy | R8 — `opossum` outbound + `under-pressure` inbound; `errorFilter` on 4xx |
| Rate-limit dimensions and store failure | R9 — named buckets, `trustProxy`, per-bucket `skipOnError` |
| Public rendering approach | R10 — server templates now, React SSR only when needed |
| OG/metadata source of truth | R11 — one `buildPageMeta()` pure function |
| Soft-404 and canonicalisation | R12 — real 404s, `wildcard: false`, 301 to canonical origin |
| Sitemap/robots generation | R13 — live query, contract-aware, one source |
| Structured data freshness | R14 — generated per request from live state |
| Multilingual targeting | R15 — `lang` + reciprocal `hreflang` + `x-default` |
| Error response shape | R16 — RFC 9457 problem+json everywhere |
| Logging, redaction, audit | R17 — pino with `redact`; separate audit table |
| Data access and migrations | R18 — `pg` + SQL migrations |
| Cross-client validation | R19 — Zod in `packages/contracts`, OpenAPI generated |
| Test approach | R20 — Vitest + `inject()`; matrix and crawl-posture suites |
| Shutdown and shedding | R21 — `close-with-grace`, readiness fails first |
| Public caching / CWV | R22 — etag + per-surface `Cache-Control`; `no-store` when gated |
| Media derivatives, formats, and upload safety | R23 — `sharp` sync for images, `ffmpeg` queued for video; content-addressed storage |

### Owned by the club, not resolvable here

| Item | Consequence while unknown | Owner |
|---|---|---|
| Canonical host and scheme | Canonicalisation and absolute OG URLs use a placeholder origin | Club |
| Legacy URL inventory | Redirect mechanism ships and is tested; the table is empty, so FR-029 cannot be verified complete | Club |
| Payment, SMS, and mail providers | Built against stub interfaces; breaker policies are tuned on assumed latencies | Club |
| Expired-partner disposition | Default is retained-but-non-indexed; recorded as a changeable decision (§10.5) | Club |
| Whether legacy member data is imported at all | Determines whether the forced-reset path in R5 is exercised | Club |
