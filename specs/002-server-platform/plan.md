# Implementation Plan: Server Platform Foundation

**Branch**: `002-server-platform` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-server-platform/spec.md`, derived from [`BUSINESS_DESCRIPTION.md`](../../BUSINESS_DESCRIPTION.md)

## Summary

Build the cross-cutting server layer that every later German World Club domain module sits on: **RBAC with JWT**, **request timeouts**, **circuit breaking**, **rate limiting**, **server-rendered public pages with OG/metadata handlers**, and **the full §10 SEO surface** — sitemap, robots, canonicalisation, structured data, and honest status codes.

Four decisions carry the design, each forced by a business rule rather than chosen for taste:

1. **The access token carries identity, never authorization.** §11's five-flag permission matrix is staff-editable at any moment and SC-003 requires a revocation to bite on the next request, so permissions are resolved server-side per request. Membership entitlement is likewise resolved at point of use, because a card can lapse mid-session and §12.2 makes discounting entitlement-driven.
2. **Every route declares its access posture, or the server refuses to start.** §10.1's "silence is not an acceptable default in either direction" is applied to authorization as well as to crawl posture, turning the most common authorization defect — an unguarded new route — into a startup failure instead of a review checklist item.
3. **Timeouts and breakers are budget-coupled.** Verified in this environment: Fastify's `requestTimeout` defaults to **`0`, disabled**, so the delivered server will hold a stalled request open forever. Four layers of deadline are introduced with the rule that a request's own budget must exceed the sum of the outbound budgets it can incur — otherwise the caller gives up first and its retry lands on a request still in flight, which is how a slow dependency becomes an outage.
4. **Public delivery is server-rendered from one metadata resolver.** §10.2 requires real content in the first response because preview bots run no JavaScript, and §10.3 requires metadata to derive from the same source as content. One pure `buildPageMeta(record)` produces titles, canonical URLs, OG/Twitter tags, `hreflang`, and JSON-LD together, so they cannot drift apart.

5. **The server shapes what it sends.** Media is transformed at ingest into the sizes and formats actually delivered, and no client is handed the stored original as a rendering path. §10.9 already required this — images are the dominant weight on exactly the public pages whose visibility the club sells, and unsized images are the most common cause of layout shift — and Constitution Principle VI now makes it non-negotiable.

The single most valuable change is also the smallest: the existing `setNotFoundHandler` answers every unknown non-`/api` path with `index.html` at **HTTP 200**. That is verbatim the defect §10.6 and §12.13 name as a thing to explicitly prevent and regression-test — an unbounded set of duplicate indexable URLs. It is fixed and locked behind a test in Phase B.

**Scope boundary**: this feature delivers the platform, not the domain. Events, partners, membership cards, marketplace, Threads, messaging, newsletters, and mobile onboarding are later features that consume this layer. The schema here is the minimum identity and authorization model needed to gate them.

## Technical Context

**Language/Version**: JavaScript (ESM, ES2023), Node.js 22.23.2 LTS *(verified in this environment)*

**Primary Dependencies**: Fastify 5.12.3 *(installed)* · `@fastify/jwt` 10.2.2 · `@fastify/rate-limit` 11.2.0 · `@fastify/cookie` 11.1.2 · `@fastify/csrf-protection` 8.0.1 · `@fastify/helmet` 13.1.1 · `@fastify/under-pressure` 9.1.0 · `@fastify/static` 10.1.3 *(installed)* · `@fastify/etag` 6.2.0 · `@fastify/compress` 9.2.0 · `@fastify/sensible` 6.0.5 · `@fastify/request-context` 7.0.0 · `@fastify/swagger` 9.8.1 · `@fastify/redis` 9.0.0 · `fastify-plugin` 6.0.0 · `opossum` 10.0.0 · `argon2` 0.45.1 · `pg` 8.23.0 · `zod` 4.6.5 · `fastify-type-provider-zod` 7.0.0 · `pino` 10.3.1 · `undici` 8.10.2 · `close-with-grace` 2.5.0 · `croner` 10.0.1 · `@fastify/multipart` 10.1.1 · `sharp` 0.35.4 · `file-type` 22.1.0 · `pg-boss` 12.32.0 · `ffmpeg-static` 5.3.0

> All versions above were resolved from the registry during planning, not recalled. Two omissions are deliberate: `fluent-ffmpeg` (latest release 2.1.3, effectively unmaintained — `ffmpeg` is spawned directly via `node:child_process`, which also gives the hard-kill control the budget rule needs), and `@fastify/circuit-breaker`, which is **absent** — it breaks inbound routes, which duplicates `under-pressure`; the outbound dependency isolation this feature needs is `opossum`'s job (research R8).

**Storage**: PostgreSQL (primary, relational integrity load-bearing per §1.2) · Redis (rate-limit buckets, session revocation denylist, breaker stats). This feature's schema is the platform layer only: `members` identity/status columns, `admin_users`, `admin_permissions`, `sessions`, `refresh_tokens`, `audit_log`, `job_runs`, `seo_metadata`, `assets`, `asset_variants`, `password_reset_tokens`, `legacy_redirects`. **Object storage** (S3-compatible in deployed environments, local-disk driver in development) holds media originals and derivatives, so derivatives are not tied to an app instance and can be fronted by a CDN.

**Testing**: Vitest 5 driving `fastify.inject()` — no listening port. Dedicated suites for the authorization matrix, crawl posture per §10.1 surface, soft-404 regression, and induced dependency failure. `testcontainers` for Postgres and Redis where available.

**Target Platform**: Linux container behind a TLS-terminating reverse proxy. Serves three clients — member web + public site, React Native mobile, staff admin console.

**Project Type**: Web service (API + server-rendered public surface) in an npm workspace alongside the existing `client/`.

**Performance Goals**: p95 < 200 ms for authenticated reads excluding outbound dependency time · public pages meet Core Web Vitals thresholds (§10.9) · a hung dependency must not move the p99 of unrelated routes by more than 20% (SC-010).

**Constraints**: Deny-by-default route posture, enforced at startup · no authorization or entitlement data in tokens · single active session per account, enforced by a database constraint · request budget > Σ outbound budgets, asserted at startup · public reads never rate-limited into invisibility · zero credentials, tokens, one-time codes, or member contact details in logs · no unknown URL may return a success status · no client is served a stored original as a rendering path · upload type determined by content inspection, never by filename.

**Scale/Scope**: Club-scale — low thousands of members, tens of staff, hundreds of partner and content pages. Concurrency correctness (quotas, capacity, counters) matters far more than throughput. ~14 server plugins, ~9 platform tables, 6 public page types.

**Runtime verification performed during planning**: `requestTimeout` default `0` (disabled), `headersTimeout` 60 s, `keepAliveTimeout` 72 s; `AbortSignal.timeout` and `AbortSignal.any` both available; Fastify 5.12 deprecates top-level `disableRequestLogging` in favour of `logController`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Constitution status**: `.specify/memory/constitution.md` was **ratified at v1.0.0 on 2026-09-15**, with six principles. This plan's earlier "PASS (vacuous)" result is void; the design is now checked against real principles.

**Initial check (pre-Phase 0)**: PASS *(re-evaluated post-ratification)*

**Post-design re-check (post-Phase 1)**: **PASS with one remediated violation** — Principle VI was unsatisfied by the original design and is the reason User Story 3 exists.

| Principle | Verdict | How this design satisfies it |
|---|---|---|
| **I. One Rule Set, Three Clients** | PASS | `packages/contracts` holds schemas, error types, and permission constants every client imports (R19). No authorization or entitlement data in tokens (R3). `GET /auth/me` is display data, re-checked server-side on every operation |
| **II. Declare Every Posture; Silence Fails The Build** | PASS | `onRoute`/`onReady` registry fails startup on any undeclared route (R4). `seo/surfaces.js` is the single crawl-posture table driving robots, headers, and postures. Permissions resolved per request, never from claims. Object guards enforce target-dependent rules in-transaction |
| **III. Published State Must Match Real State** | PASS | Real 404s with `wildcard: false` and a ≥50-path corpus (R12). Structured data and sitemap generated from live state (R13, R14). One canonical origin with 301s. Legacy redirect table. Slug-based URLs |
| **IV. Integrity Lives In The Database** | PASS | Partial unique index for single-session (R2). `BEFORE DELETE` trigger on `members`. Append-only `audit_log` via revoked grants. Deterministic payment reference. **FR-043 now delivers the transactional counter primitive** later quota features build on |
| **V. Failure Is Explicit And Bounded** | PASS | Four timeout layers with the Σ-outbound startup assertion (R7). Per-dependency `opossum` policy with `errorFilter` excluding business rejections, each with a declared fallback (R8). Per-bucket `skipOnError` (R9). Public reads deliberately generous |
| **VI. The Server Shapes What Leaves It** | **PASS after remediation** | Originally **VIOLATED**: no media pipeline existed, and response serialization schemas were scheduled in the final phase. Now: US3 delivers ingest-time derivatives, content-inspected validation, metadata stripping, recorded dimensions, and content-addressed immutable variants ([media-pipeline.md](./contracts/media-pipeline.md)); response schemas move into each story's own phase; central `pino.redact` and sanitised problem+json `detail` were already in place |

**Complexity requiring justification against a principle**: none. The dependencies added for Principle VI (`sharp`, `ffmpeg-static`, `pg-boss`) are recorded in Complexity Tracking; none weakens a principle.

> **Governance note**: the constitution requires this check before design and again after; both are recorded above. Principle VI's violation was found by `/speckit-analyze` **before** implementation — the outcome the gate exists to produce.

## Project Structure

### Documentation (this feature)

```text
specs/002-server-platform/
├── plan.md                      # This file
├── spec.md                      # Feature specification
├── research.md                  # Phase 0 output — 23 decisions, resolved unknowns
├── data-model.md                # Phase 1 output — platform schema + state machines
├── quickstart.md                # Phase 1 output — runnable validation guide
├── contracts/                   # Phase 1 output
│   ├── auth-api.md                  # Sign-in, OTP, refresh, logout, session endpoints
│   ├── rbac-model.md                # Route posture declaration + permission resolution
│   ├── seo-delivery.md              # buildPageMeta, OG tags, sitemap, robots, 404, JSON-LD
│   ├── media-pipeline.md            # Upload validation, derivatives, storage, delivery
│   ├── resilience.md                # Timeout budgets, breaker policies, rate-limit buckets
│   └── http-conventions.md          # Error envelope, headers, status codes, correlation
└── tasks.md                     # Phase 2 output (/speckit-tasks — NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
package.json                     # MODIFIED — becomes the npm workspace root
server.js                        # DELETED — replaced by server/src/{app,server}.js

packages/
└── contracts/                   # NEW — the one-rule-set-three-clients boundary (§12.15)
    ├── package.json
    └── src/
        ├── auth.js                  # Zod schemas: credentials, OTP, refresh, session
        ├── errors.js                # RFC 9457 problem types + codes, shared by all clients
        ├── permissions.js           # Module names, the five flags, principal audiences
        └── seo.js                   # Page-metadata shape, structured-data shapes

server/
├── package.json                 # NEW
├── migrations/                  # NEW — plain SQL, applied by a small runner
│   ├── 001_extensions.sql                    # citext + all 8 enum types
│   ├── 002_audit_log.sql                     # append-only; UPDATE/DELETE revoked
│   ├── 003_assets_and_variants.sql           # originals + derivatives (Principle VI)
│   ├── 004_seo_metadata.sql
│   ├── 005_members.sql                       # incl. mobile, password_reset_tokens
│   ├── 006_admin_users_and_permissions.sql
│   ├── 007_sessions_and_refresh_tokens.sql   # incl. one-active-session partial unique index
│   ├── 008_otp_and_device_approvals.sql
│   ├── 009_legacy_redirects.sql
│   └── 010_job_definitions_and_runs.sql
├── src/
│   ├── app.js                   # NEW — builds the Fastify instance; no listen(). The test seam.
│   ├── server.js                # NEW — process entry: config, listen, close-with-grace
│   ├── config/
│   │   ├── env.js                   # Zod-validated env; refuses to boot on a bad value
│   │   └── budgets.js               # Route time budgets + the Σ-outbound startup assertion
│   ├── plugins/                 # Autoloaded, order-significant
│   │   ├── 00-request-context.js    # ULID correlation id, X-Request-Id
│   │   ├── 01-logging.js            # pino via logController; redact allowlist
│   │   ├── 02-security-headers.js   # helmet + CSP nonce for inline critical CSS
│   │   ├── 03-canonical-origin.js   # 301 non-canonical host/scheme (FR-028)
│   │   ├── 04-legacy-redirects.js   # 301 table-driven legacy → new (FR-029)
│   │   ├── 05-db.js                 # pg pool; per-connection statement_timeout
│   │   ├── 06-redis.js              # limits, revocation denylist, breaker stats
│   │   ├── 07-rate-limit.js         # named buckets; per-bucket skipOnError (R9)
│   │   ├── 08-under-pressure.js     # load shedding + readiness backing
│   │   ├── 09-jwt.js                # EdDSA verify from cookie or bearer (R6)
│   │   ├── 10-auth.js               # principal resolution, session + denylist check
│   │   ├── 11-rbac.js               # route-posture registry, startup gate, requirePermission
│   │   ├── 12-deadline.js           # AbortSignal.any(timeout, clientDisconnect) (R7 L3)
│   │   ├── 13-breakers.js           # opossum instance per dependency (R8)
│   │   └── 14-error-handler.js      # RFC 9457 + HTML error page; real 404s (R12, R16)
│   ├── auth/
│   │   ├── tokens.js                # mint/verify access; opaque refresh + rotation
│   │   ├── sessions.js              # single active session; reuse detection
│   │   ├── passwords.js             # argon2id; legacy forced-reset path
│   │   ├── otp.js                   # 4-digit code, attempt ceiling, device binding
│   │   └── routes.js                # sign-in, verify-otp, refresh, logout, whoami
│   ├── authz/
│   │   ├── permissions.js           # 30 s snapshot cache + explicit invalidation (R3)
│   │   ├── require-permission.js    # Layer 1 — module capability
│   │   └── object-guards.js         # Layer 2 — FR-009 admin/superadmin target guard
│   ├── seo/
│   │   ├── build-page-meta.js       # THE metadata resolver (R11) — pure, unit-tested
│   │   ├── structured-data.js       # Organization / LocalBusiness / Event / Article / Breadcrumb
│   │   ├── sitemap.js               # live query + contract-aware predicate (R13)
│   │   ├── robots.js                # generated from the §10.1 surface table
│   │   └── surfaces.js              # THE §10.1 table: posture per surface, one source
│   ├── public/                      # Server-rendered public routes (R10)
│   │   ├── templates/               # Layout + per-type templates; escaped interpolation
│   │   └── routes.js                # landing, partner, outlet, event, article, legal
│   ├── media/
│   │   ├── validate.js              # Magic-byte typing, pre-decode pixel bound (FR-052/053)
│   │   ├── derive-image.js          # sharp: breakpoints, WebP + alpha-aware fallback, no upscale
│   │   ├── derive-video.js          # ffmpeg subprocess, hard-killed on budget; WebM + poster
│   │   ├── strip-metadata.js        # EXIF/XMP/ICC incl. GPS (FR-054)
│   │   ├── storage.js               # S3-compatible driver + local-disk dev driver
│   │   ├── queue.js                 # pg-boss work queue for video derivatives
│   │   └── routes.js                # POST /media, GET /media/:id, GET /media/:checksum/...
│   ├── integrations/                # Every outbound dependency behind an interface + stub
│   │   ├── payments.js              # fail-closed; idempotency reference (§12.5)
│   │   ├── sms.js · mail.js · geocoding.js
│   │   └── http-client.js           # undici dispatcher; per-dependency header/body timeouts
│   ├── ops/
│   │   ├── health.js                # liveness and readiness, separately (FR-050)
│   │   ├── audit.js                 # append-only audit_log writer
│   │   └── jobs.js                  # croner; per-job enable/disable; job_runs logging
│   └── db/
│       ├── pool.js · query.js · migrate.js
└── tests/
    ├── authz/matrix.test.js         # every route class × every principal kind (SC-002)
    ├── authz/object-guards.test.js  # FR-009 privilege-escalation guard
    ├── authz/route-posture.test.js  # startup fails on an undeclared route (SC-001)
    ├── auth/*.test.js              # tokens, rotation, reuse detection, single session, OTP
    ├── seo/build-page-meta.test.js  # uniqueness, escaping, required image dimensions
    ├── seo/crawl-posture.test.js    # every §10.1 surface: status + X-Robots-Tag + robots.txt
    ├── seo/soft-404.test.js         # ≥50 known-bad paths, all 404 (SC-004)
    ├── seo/sitemap.test.js          # lapsed partner absent; lastmod real (SC-008)
    ├── seo/structured-data.test.js  # validates; availability matches live state (SC-007)
    ├── resilience/timeouts.test.js  # budget honoured under induced hang (SC-009)
    ├── resilience/breaker.test.js   # transitions; 4xx does NOT trip (SC-011, SC-012)
    ├── resilience/rate-limit.test.js# both sign-in directions; crawler unaffected (SC-013/14)
    ├── media/*.test.js              # validation, bombs, strip, derivatives, formats, dedupe
    ├── ops/logging-redaction.test.js# zero credentials in log output (SC-016)
    └── fixtures/bad-paths.js        # the soft-404 corpus

client/                          # UNCHANGED by this feature (feature 001)
└── public/robots.txt            # DELETED — superseded by the generated route (R13)
└── public/sitemap.xml           # DELETED — superseded by the generated route (R13)

BUSINESS_DESCRIPTION.md          # UNTOUCHED — requirements source
```

**Structure Decision**: An npm workspace with `server/`, the existing `client/`, and a shared `packages/contracts/`. The workspace is not organisational tidiness — `packages/contracts` is the structural enforcement of §12.15, giving request/response schemas, error types, and permission constants exactly one home that the API, the member web app, the mobile app, and the admin console all import. §1.1 names re-implementing the same rule per client as the legacy system's most persistent defect; a shared package makes that physically harder than doing it right.

Within `server/src`, plugins are numbered because their order is semantically load-bearing: correlation before logging, canonical redirects before routing, rate limits before authentication (so an unauthenticated flood is cheap to refuse), authentication before authorization, deadlines before handlers. The numbering makes a mis-ordering visible in a directory listing.

The `app.js` / `server.js` split is what makes the whole test strategy possible: `app.js` returns a built instance that never binds a port, so every suite above runs through `fastify.inject()` in-process.

## Implementation Phases

Sequenced so each phase is independently demonstrable, in the spec's priority order. Phase A is a prerequisite for everything; B through E map to User Stories 1–4.

**Phase A — Workspace, app skeleton, and the startup gates** *(blocks everything)*

Convert the root to an npm workspace; create `server/` and `packages/contracts/`; retire root `server.js` into `app.js` + `server.js`. Stand up the numbered plugin chain with correlation ids, redacted `pino` logging via `logController`, helmet, `@fastify/sensible`, and the RFC 9457 error handler. Add Zod-validated env config that refuses to boot on a bad value. Wire the `pg` pool and Redis. Set up the migration runner and apply the platform schema.

Land the two startup gates now, before any route exists to violate them: the **route-posture registry** (`onRoute` collects, `onReady` fails on any undeclared route) and the **budget assertion** (request budget > Σ outbound budgets). Both are cheap when the route table is empty and become progressively more valuable; introducing them later means retrofitting postures onto routes already written.

Set the four timeout layers (R7) as part of this phase rather than with Phase D, because `requestTimeout: 0` is a live resource leak and the fix is one server option.

*Demonstrable*: the server boots, serves `/health/live` and `/health/ready`, logs a correlated request with credentials redacted, returns problem+json on error, and **fails to start** if a route is registered without a posture.

**Phase B — User Story 2 (P2): public delivery, OG tags, and the whole SEO surface**

Taken before User Story 1 deliberately: it closes a defect that is live in the delivered code, needs no identity model, and is the revenue-bearing half of §10.

Build `seo/surfaces.js` as the single §10.1 table, then `buildPageMeta()` with escaping and required image dimensions, `structured-data.js`, the generated `robots.txt` and `sitemap.xml` routes, canonical-origin 301s, and the table-driven legacy redirect layer. Replace `@fastify/static`'s catch-all with `wildcard: false` and a **real 404** for HTML and problem+json for API. Build the server-rendered public templates for landing, partner, outlet, event, article, and legal pages, plus `hreflang` alternates. Add `@fastify/etag`, `@fastify/compress`, and per-surface `Cache-Control` with `no-store` on anything gated. Delete the static `client/public/robots.txt` and `sitemap.xml`.

*Demonstrable*: every public page returns real content with JavaScript disabled, share previews render correctly from HTML alone, unknown URLs 404, the sitemap reflects live publication state, and the ≥50-path soft-404 corpus passes.

**Phase C — User Story 1 (P1): RBAC with JWT**

Build `auth/`: EdDSA access-token minting, opaque refresh tokens with rotation and reuse detection, the single-active-session constraint, argon2id password verification with the legacy forced-reset path, and the OTP flow with device binding. Build `authz/`: the permission snapshot cache with explicit invalidation, `requirePermission` for module capability, and `object-guards.js` for FR-009. Declare a posture on every route added in Phase B (they will already have one, or Phase A refused to boot). Apply the `sign-in-ip`, `sign-in-account`, `otp-send`, `otp-verify`, and `password-reset` buckets — pulled forward from Phase D, because an unthrottled credential endpoint is a security defect.

Write the authorization matrix test as a data table so every subsequent route forces a row.

*Demonstrable*: each principal kind reaches exactly its declared route set; a revoked permission is refused on the next request without re-login; a second sign-in terminates the first session; a replayed refresh token kills the lineage; a suspended member cannot sign in.

**Phase D — User Story 3 (P3): media ingest and delivery**

Build `media/validate.js` (magic-byte typing, allowlist, pre-decode pixel bound), `strip-metadata.js`, `storage.js` with both drivers, and `derive-image.js` producing the four breakpoints as WebP plus an alpha-aware fallback, never upscaled. Add `POST /media` inside an 8 s budget so image derivatives are complete in the response. Add `queue.js` and `derive-video.js` for the asynchronous half, with the asset reporting `processing` then `ready` or `failed`. Isolate generation behind a fail-closed breaker. Point `buildPageMeta` at the `large` WebP variant and switch the public templates to `<picture>` with `srcset` and explicit dimensions.

*Demonstrable*: a 2 MB photograph uploads and returns every variant URL with recorded dimensions; a phone-width layout receives tens of kilobytes; a mismatched extension and a decompression bomb are both refused; a GPS-bearing photo stores with no location metadata.

**Phase E — User Story 4 (P4): resilience**

Build `integrations/` as interfaces with stub implementations, each behind an `opossum` breaker carrying its policy from R8 — including the `errorFilter` that keeps 4xx business rejections from tripping the circuit, and fail-closed payments. Add the handler-deadline plugin combining `AbortSignal.timeout` with client-disconnect via `AbortSignal.any`, propagated into `pg` and `undici`. Complete the remaining rate-limit buckets, configure `trustProxy` from deployment input with a production startup check, and set per-bucket `skipOnError`. Add `@fastify/under-pressure` shedding and wire readiness to it. Add `close-with-grace` with readiness failing before the drain begins.

*Demonstrable*: an induced dependency hang is contained within budget without moving unrelated p99; the breaker opens, probes, and recovers; a declined payment leaves it closed; credential stuffing is refused in both directions; a crawl at normal rate sees zero 429s; SIGTERM drops no in-flight request.

**Phase F — User Story 5 (P5): operability**

Add the append-only `audit_log` writer and record sign-ins, denials, permission changes, session terminations, and refresh replay. Surface breaker transitions, limiter refusals, and per-route timeouts as metrics. Add `croner` job scheduling with per-job enable/disable and `job_runs` logging, as §11 requires. Generate OpenAPI from the shared Zod schemas via `@fastify/swagger`.

*Demonstrable*: a failure at each layer produces a correlated, redacted trail; a denial is queryable from the audit table; a job run records start, end, and outcome.

**Phase G — Verification**

Run every suite in `server/tests`, then the cross-cutting checks: a crawl of the generated sitemap asserting metadata uniqueness (SC-006), structured-data validation against live state (SC-007), the §10.1 crawl-posture sweep (SC-008), Core Web Vitals on a production build of the public pages (SC-017), and a log scan for credential patterns (SC-016). Confirm each of SC-001 through SC-017 has a named test.

## Risks & Open Items

| # | Item | Impact | Handling |
|---|---|---|---|
| 1 | **The live soft-404** — `setNotFoundHandler` returns `index.html` at HTTP 200 for every unknown non-`/api` path | Unbounded duplicate indexable URLs; crawlers cannot distinguish a real page from a typo; §12.13 violated in delivered code | Fixed in Phase B: `wildcard: false`, a real 404, and a ≥50-path regression corpus so it cannot return. **Highest-value, lowest-cost item in this plan.** |
| 2 | **`requestTimeout` defaults to `0`** — verified in this environment | A stalled request is held open indefinitely; a slow client or dependency can exhaust connections | Set explicitly in Phase A alongside the other three deadline layers (R7). One server option; no reason to defer it. |
| 3 | **Access tokens stay valid for up to 10 minutes after session revocation** | A revoked session retains read access for that window | Deliberate and bounded. Mitigated by the Redis `sid` denylist checked per request; permission changes bypass the window entirely because authorization is never read from the token (R3). The residual window is documented, not hidden. |
| 4 | **`trustProxy` must match the real deployment hop count** | Wrong low → every client keys to the proxy address and per-address limits are meaningless. Wrong high (`true`) → a client forges `X-Forwarded-For` and bypasses every limit | Deployment input, validated at startup; production boot fails if unset. Documented as a precondition in quickstart. |
| 5 | **Legacy URL inventory is not available** | FR-029 cannot be verified complete; existing search equity is at risk on cutover | Mechanism and tests ship in Phase B with an empty table, so populating it is data entry rather than development. **Owner: the club.** Must be supplied before public cutover. |
| 6 | **External providers are not selected** — payments, SMS, mail, geocoding | Breaker thresholds and timeouts are tuned against assumed latencies and will need revisiting | Each is an interface with a stub, so resilience behaviour is fully testable now and swapping in a provider touches one file. Re-tune when real latency data exists. **Owner: the club.** |
| 7 | **Redis is a new operational dependency** | Rate limits and the revocation denylist depend on it | Its failure mode is explicit per bucket rather than inherited (R9): public reads fail open, credential paths fail closed. It is itself behind a 250 ms breaker. Development runs single-process, and the difference is documented rather than hidden. |
| 8 | **Constitution is still an unfilled template** | Second consecutive feature with no ratified principles to check — and the first handling credentials, PII, and payment paths | Eight self-imposed gates are applied and tested in its place. `/speckit-constitution` recommended **before** implementation begins, not after. |
| 9 | **Dependency count rises from 2 to ~24** | More supply-chain surface and more to keep current | 17 are first-party `@fastify/*` plugins replacing code that would otherwise be hand-rolled and worse. Justified individually in Complexity Tracking. |
| 10 | **Forced password reset for migrated members** | Every migrated member must reset before signing in | The correct security call: unsalted MD5 of a human-chosen password is effectively public, so accepting one authenticates anyone holding the dump (R5). §3.2 already routes Inactive members through reset, so the flow exists. Needs a communications plan. **Owner: the club.** |
| 11 | **Rate limiting versus crawl budget** | A limit tight enough to stop abuse could refuse a legitimate crawler and undermine the partner visibility the club sells | The one place two of this feature's goals genuinely conflict. Resolved in favour of SEO: `public-read` is generous, allow-lists verified crawlers, and SC-014 tests that a normal crawl sees zero refusals. |
| 12 | **Workspace conversion touches the repo root** | Root `package.json` changes and `server.js` moves while feature 001 is still in flight on another branch | Phase A is a single mechanical commit; `client/` is untouched and its `package.json` unchanged. Worth merging 001 first to keep the diffs from overlapping. |
| 13 | **`disableRequestLogging` is deprecated in Fastify 5.12** | Using the obvious option now creates a Fastify 6 migration chore | `logController` is used from the start (verified against the installed type definitions). |
| 15 | **Upload is the sharpest attack surface in this feature** | A missed check turns an endpoint into stored XSS, memory exhaustion, or a PII leak | Layered and ordered: streamed byte cap, magic-byte typing, allowlist, **pre-decode** pixel bound plus `sharp`'s `limitInputPixels`, GPS stripping, SVG refused outright, `nosniff` + explicit `Content-Type` on delivery. Each has a named test |
| 16 | **Video derivatives cannot be produced inside a request** | The stated intent — derivatives generated at upload time — holds for images but not video | Images are synchronous (≈200–600 ms for the full set, inside an 8 s budget); video is queued and reports `processing`. Dimensions are probed synchronously either way, so §10.9's layout-shift requirement still holds. Documented in [media-pipeline.md §5](./contracts/media-pipeline.md) rather than glossed |
| 17 | **`ffmpeg` is a native subprocess with a frequent CVE history** | A malformed upload could reach a vulnerable decoder | Spawned directly with a hard kill on budget, never through the unmaintained `fluent-ffmpeg`. Runs off the event loop so a transcode does not trip load shedding. Pinned via `ffmpeg-static` and patch-tracked |
| 18 | **Object storage is a new operational dependency** | Media unavailable if it is | Behind a driver interface with a local-disk implementation for development; generation is fail-closed, so an outage refuses uploads rather than recording half-ready assets |
| 14 | **Expired-partner disposition is a business decision** | A wrong default either discards inbound links a paying partner earned, or keeps advertising a lapsed listing | Defaults to retained-but-non-indexed, which honours both concerns, and is recorded as a configured choice the club can change — which is what §10.5 asks for. **Owner: the club.** |

### Open-item review at implementation close (T204)

Every row above, re-checked against the delivered code. Three categories:
**Closed** (the mechanism exists and is exercised), **Accepted** (a deliberate
residual risk, documented rather than hidden), and **Owner: the club** (needs a
decision or data from outside engineering before public cutover).

| # | Status | Evidence / what remains |
|---|---|---|
| 1 | **Closed** | `wildcard: false` plus `globIgnore`, real `setNotFoundHandler`, 64-path regression corpus — `tests/seo/soft-404.test.js` |
| 2 | **Closed** | `requestTimeout`, `connectionTimeout`, `keepAliveTimeout` all set from validated env in `app.js`; budget rule asserted at startup |
| 3 | **Accepted** | The ≤10-minute window is real and bounded. `sid` denylist checked per request; authorization is never read from the token, so permission changes bypass the window entirely |
| 4 | **Closed (mechanism)** · **Owner: the club (value)** | `TRUST_PROXY` is Zod-validated and production boot fails if unset; `server/README.md` documents both directions of error. The hop count itself is a deployment input |
| 5 | **Owner: the club** | `legacy_redirects` ships with automatic 301 registration on slug change (`seo/staff-routes.js`). The table is empty: populating it is data entry, and it must happen **before public cutover** or accumulated search equity is lost |
| 6 | **Partially closed** · **Owner: the club** | **SMS is now selected: SMSGlobal**, wired through `integrations/sms.js` with MAC auth. Payments, mail and geocoding remain interfaces with stubs — resilience behaviour is fully testable, and swapping a provider touches one file. Breaker thresholds still need re-tuning against real latency |
| 7 | **Closed** | Per-bucket `skipOnError` set explicitly on every bucket and asserted at startup; Redis sits behind its own 250 ms breaker (`app.withRedis`) |
| 8 | **Closed** | The constitution was ratified at 1.0.0 before implementation. Its six principles are enforced by four startup gates, not by review |
| 9 | **Accepted** | Justified per dependency in Complexity Tracking. Push notifications were added **without** `firebase-admin` or `expo-server-sdk` — both transports run on `undici`, which was already present |
| 10 | **Owner: the club** | The forced-reset path is implemented and tested (`credentialState`, `tests/auth/passwords.test.js`); an unsalted MD5 is never verified. The **communications plan** is outstanding |
| 11 | **Closed** | Resolved in favour of SEO and asserted: `tests/resilience/crawler-budget.test.js` walks every public route as Googlebot across repeated passes and sees zero 429s, with a counter-assertion that the limiter is genuinely running |
| 12 | **Closed** | The workspace conversion landed as one mechanical commit; `client/` untouched |
| 13 | **Closed** | `logController` used from the start; no deprecated option in the codebase |
| 14 | **Owner: the club** | Defaults to retained-but-non-indexed, recorded as a configured choice |
| 15 | **Closed** | Every layer implemented and separately tested: streamed cap, magic-byte typing, allowlist, pre-decode pixel bound plus `limitInputPixels`, EXIF/GPS stripping, SVG refused outright, `nosniff` on delivery |
| 16 | **Closed** | Images synchronous, video queued and reporting `processing`; dimensions probed synchronously either way. A failed transcode records `failed` **with a reason** — a stuck `processing` row is refused by the database constraint as well as by the worker |
| 17 | **Closed** | Direct `spawn` with a hard `SIGKILL` at the budget; `fluent-ffmpeg` not used. Pinned via `ffmpeg-static` |
| 18 | **Closed** | Driver interface with local-disk and S3 implementations; generation is fail-closed, so an outage refuses uploads rather than recording half-ready assets |

**Nothing is unowned.** The four items still open (5, 6, 10, 14) each name the
club as owner and each has its mechanism already shipped, so closing them is a
decision or a data-entry task rather than development work. Items 5 and 10 are
the two that **must** be settled before public cutover.

## Complexity Tracking

The Constitution Check passes vacuously, so nothing is *required* to be justified here. One item is recorded anyway, because a self-imposed gate flagged it.

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Runtime dependencies rise from 2 to ~24 | 17 are first-party `@fastify/*` plugins — JWT verification, CSRF, rate limiting, security headers, compression, etag, load shedding, swagger. Each replaces security-sensitive code that would otherwise be hand-rolled. The 7 non-Fastify additions are `opossum` (breaker), `argon2` (hashing), `pg` (database), `zod` + `fastify-type-provider-zod` (shared contracts), `undici` (outbound timeouts), `croner` (scheduling) — each backing a specific FR | Hand-rolling CSRF, JWT verification, rolling-window breakers, or password hashing is exactly the category where a subtle error is a vulnerability rather than a bug, and the failure is invisible until an incident |
| Two authorization layers instead of one | FR-009's rule depends on the **target row**, not the caller's flags, so no route-level declaration can express it. Collapsing the layers is how that privilege-escalation path gets lost — a reviewer sees `module: 'admins', flag: 'edit'` and concludes the route is guarded | A single declarative layer cannot represent an object-level rule at all; a single imperative layer makes the startup posture gate (SC-001) impossible |
| `sharp` and `ffmpeg-static` for media derivatives | Principle VI prohibits serving an unoptimized original, and §10.9 requires appropriate sizes and formats. `sharp` is the standard libvips binding; `ffmpeg` is the only realistic transcoder | Client-side resizing re-implements a server rule in three clients (Principle I) and cannot strip EXIF before storage. CDN-edge resizing keeps the unoptimized original as the stored source of truth and still needs server-side validation |
| `pg-boss` as a work queue alongside `croner` | Video transcoding is event-triggered work that cannot fit a request budget; `croner` is a time-triggered scheduler | Running transcodes inline violates FR-032. Polling for pending work with `croner` adds latency and a second source of truth for queue state |
| An npm workspace for what is currently one service and one client | `packages/contracts` is the structural form of §12.15, and two more clients are committed in §1.2 | A flat root leaves shared schemas nowhere to live, so mobile and admin re-declare validation and drift — the specific legacy defect §1.1 names |
| Four timeout layers rather than one setting | Each covers a failure the others cannot: slow client, idle socket, slow handler, slow dependency | Any single layer leaves at least one unbounded; `requestTimeout` alone covers only the least likely of the four |
