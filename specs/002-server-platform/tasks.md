---

description: "Task list for Server Platform Foundation"
---

# Tasks: Server Platform Foundation

**Input**: Design documents from `/specs/002-server-platform/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: **INCLUDED** — 55 of the 205 tasks are test files, written before their implementation within each phase. The spec requests them explicitly — SC-001 ("verified by a test that fails the build"), SC-002, SC-004, SC-012 ("verified by an explicit test"), SC-016 — every file in `contracts/` carries a "Test contract" section, and `BUSINESS_DESCRIPTION.md` §10.10 requires SEO to be "checked automatically as part of the delivery pipeline, the same way accessibility and functional behaviour are."

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = RBAC/JWT (P1) · US2 = Public delivery & SEO (P2) · US3 = Resilience (P3) · US4 = Operability (P4)

## Path Conventions

npm workspace per [plan.md](./plan.md) "Structure Decision":

- `server/src/`, `server/tests/`, `server/migrations/` — this feature's service
- `packages/contracts/src/` — schemas shared by API, web, mobile, admin (§12.15)
- `client/` — feature 001, touched only to delete two superseded static files

> **Migration numbering**: the runner applies in filename order. No migration in this feature has a cross-story foreign key (`sessions.account_id` and `audit_log` reference ids without FKs by design — see [data-model.md §7](./data-model.md)), so stories can be built in any order and numbers reassigned to match.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Workspace conversion and tooling. No behaviour yet.

- [X] T001 Convert `/package.json` to an npm workspace root with `workspaces: ["server", "client", "packages/*"]`, keeping `type: "module"` and removing the `fastify`/`@fastify/static` dependencies that move to `server/`
- [X] T002 [P] Create `/packages/contracts/package.json` as `@gwc/contracts`, ESM, with `zod` as its only dependency
- [X] T003 [P] Create `/server/package.json` as `@gwc/server` with the runtime dependencies listed in plan.md "Primary Dependencies" and `vitest` as a devDependency
- [X] T004 Run `npm install` from the repository root and verify `/server`, `/client`, and `/packages/contracts` all resolve into the root `/node_modules`
- [X] T005 [P] Create `/server/.env.example` documenting `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `CANONICAL_ORIGIN`, `TRUST_PROXY`, `PORT`, `NODE_ENV`, each with a comment on why it has no safe default
- [X] T006 [P] Create `/server/eslint.config.js` extending the pattern in `client/eslint.config.js`, with Node and Vitest globals
- [X] T007 [P] Create `/server/vitest.config.js` (node environment, `setupFiles: './tests/setup.js'`) and `/server/tests/setup.js`
- [X] T008 [P] Create `/packages/contracts/src/errors.js` exporting the RFC 9457 problem `type` URIs and titles from [http-conventions.md §1](./contracts/http-conventions.md)
- [X] T009 [P] Create `/packages/contracts/src/permissions.js` exporting the 19 `admin_module` names, the five flag names, and the `member`/`admin` audiences from [rbac-model.md §3](./contracts/rbac-model.md)
- [X] T010 Add scripts to `/server/package.json`: `dev`, `start`, `test`, `test:coverage`, `migrate`, `seed:dev`, `keys:generate`, `token:mint`, `verify:seo`
- [X] T011 [P] Update `/.gitignore` to ignore `server/.env` and `server/coverage/`

**Checkpoint**: `npm install` succeeds; no server code exists yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The app skeleton, the two startup gates, and the shared tables. Corresponds to plan.md **Phase A**.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. The startup gates in particular must land *before* any route exists, or they become a retrofit.

### App skeleton and configuration

- [X] T012 Create `/server/src/app.js` exporting `buildApp(opts)` that returns a configured Fastify instance and **never calls `listen()`** — this is the seam every test injects through
- [X] T013 Create `/server/src/server.js` as the process entry point: load config, `buildApp()`, `listen()`, wire signal handling
- [X] T014 Create `/server/src/config/env.js` validating every environment variable with Zod and **throwing on a bad or missing value** so a misconfigured process cannot boot
- [X] T015 Add the production-only startup check in `/server/src/config/env.js` that refuses to boot when `TRUST_PROXY` or `CANONICAL_ORIGIN` is unset (plan.md Risk 4)
- [X] T016 Delete `/server.js` from the repository root, now superseded by T012–T013

### Timeout layers 1, 2 and 4 config

- [X] T017 In `/server/src/app.js`, set `requestTimeout: 30000`, `connectionTimeout: 35000`, `keepAliveTimeout: 72000`, `forceCloseConnections: 'idle'`, `bodyLimit` — **`requestTimeout` defaults to `0`/disabled**, verified against the installed Fastify 5.12.3 (plan.md Risk 2)
- [X] T018 Create `/server/src/config/budgets.js` holding the per-route-class handler deadlines and per-dependency outbound budgets from [resilience.md §1](./contracts/resilience.md)
- [X] T019 Add the **budget assertion** to `/server/src/config/budgets.js` — an `onReady`-time check that Σ(outbound budgets) < route deadline < `requestTimeout` for every route class, throwing with the offending class named (FR-033)
- [X] T020 [P] Write `/server/tests/resilience/budget-assertion.test.js` asserting startup throws when a route's outbound budgets sum to ≥ its deadline

### Observability foundations

- [X] T021 Create `/server/src/plugins/00-request-context.js` generating a ULID per request via `genReqId`, echoing `X-Request-Id`, and exposing it through `@fastify/request-context`
- [X] T022 Create `/server/src/plugins/01-logging.js` configuring `pino` through Fastify's **`logController`** option — not the top-level `disableRequestLogging`, which 5.12 deprecates for removal in v6 (plan.md Risk 13)
- [X] T023 Add the `redact` path list to `/server/src/plugins/01-logging.js` covering every path in [http-conventions.md §5](./contracts/http-conventions.md), configured at logger construction so it applies to code not yet written
- [X] T024 [P] Write `/server/tests/ops/logging-redaction.test.js` asserting a request carrying a password, token, OTP, and email produces **zero** log lines matching any credential or contact-detail pattern (SC-016)

### Error handling and HTTP conventions

- [X] T025 Create `/server/src/plugins/14-error-handler.js` with `setErrorHandler` emitting `application/problem+json` per [http-conventions.md §1](./contracts/http-conventions.md), including `requestId`, and sanitising `detail` so no internal cause leaks (FR-049)
- [X] T026 Add content negotiation to `/server/src/plugins/14-error-handler.js`: HTML-accepting requests get a rendered `noindex` error page at the same status, never a JSON body in a browser address bar
- [X] T027 Register `@fastify/sensible` in `/server/src/app.js` for the standard error constructors
- [X] T028 Create `/server/src/plugins/02-security-headers.js` registering `@fastify/helmet` with HSTS, `Referrer-Policy`, and a CSP whose nonce permits the public templates' inline critical CSS
- [X] T029 [P] Write `/server/tests/http/error-envelope.test.js` asserting every error path returns the documented envelope shape and that `detail` never contains a stack trace or SQL fragment

### Data layer

- [X] T030 Create `/server/src/db/pool.js` establishing the `pg` pool with a per-connection `statement_timeout` set just inside the tightest handler deadline (timeout layer 4)
- [X] T031 [P] Create `/server/src/db/query.js` as the thin typed query helper, accepting an `AbortSignal` so a deadline cancels the underlying query rather than merely abandoning it
- [X] T032 Create `/server/src/db/migrate.js` as the SQL migration runner (applies in filename order, records applied migrations, supports rollback)
- [X] T033 Create `/server/src/plugins/05-db.js` decorating the instance with the pool and failing readiness when the database is unreachable
- [X] T034 Create `/server/src/plugins/06-redis.js` registering `@fastify/redis` for rate-limit buckets and the session denylist
- [X] T035 [P] Create `/server/migrations/001_extensions.sql` enabling `citext` and creating all 8 enum types (`member_status`, `account_kind`, `admin_module`, `approval_state`, `seo_record_type`, `asset_kind`, `asset_state`, `asset_variant`) before any table references them
- [X] T036 [P] Create `/server/migrations/002_audit_log.sql` per [data-model.md §5](./data-model.md), and **revoke UPDATE and DELETE** from the application role so append-only is enforced by the database rather than by convention
- [X] T037 [P] Create `/server/migrations/003_assets_and_variants.sql` per [data-model.md §4.1](./data-model.md) — `assets` (with `alt`, `width`, `height`, `state`, and `UNIQUE` on `checksum` for content-addressed dedupe) and `asset_variants` (`PRIMARY KEY (asset_id, variant, format)`, all of `format`/`width`/`height`/`bytes` `NOT NULL`). Shared: US3 writes them, US2 reads them for `og:image`
- [X] T038 Create `/server/migrations/004_seo_metadata.sql` per [data-model.md §4](./data-model.md) — shared by US1 (staff writes) and US2 (public reads), so it lands here — with `UNIQUE (record_type, record_id)` and `UNIQUE (record_type, slug)`
- [X] T039 Create `/server/src/ops/audit.js` as the append-only `audit_log` writer, taking the request id from the request context — needed by US1 for FR-015 and extended by US4
- [X] T040 [P] Write `/server/tests/db/migrations.test.js` asserting every migration applies and rolls back against a scratch database

### The deny-by-default route registry

- [X] T041 Create `/server/src/plugins/11-rbac.js` with an `onRoute` hook recording every registered route's `config.auth`, and an `onReady` hook that **throws, naming each offending method and path**, if any route declared no posture (FR-001)
- [X] T042 Validate declared module names in `/server/src/plugins/11-rbac.js` against `@gwc/contracts/permissions`, so a typo in a module name fails startup rather than silently denying everything
- [X] T043 [P] Write `/server/tests/authz/route-posture.test.js` asserting startup throws for a route with no `config.auth` and that the message names the method and path (SC-001)

### Handler deadlines and rate-limit mechanism

- [X] T044 Create `/server/src/plugins/12-deadline.js` combining `AbortSignal.timeout(budget)` with the client-disconnect signal via `AbortSignal.any()` — both verified available on Node 22.23.2 — and exposing the result as `request.signal` (timeout layer 3)
- [X] T045 Add the `onRequestAbort` hook to `/server/src/plugins/12-deadline.js` so a client disconnect aborts the signal and cancels in-flight work (FR-034)
- [X] T046 Create `/server/src/config/rate-limits.js` holding the named bucket table from [resilience.md §3](./contracts/resilience.md), with a startup check that **every bucket sets `skipOnError` explicitly** (FR-044)
- [X] T047 Create `/server/src/plugins/07-rate-limit.js` registering `@fastify/rate-limit` with the Redis store and a per-bucket `keyGenerator`; individual buckets are added by the story that needs them

### Health

- [X] T048 Create `/server/src/ops/health.js` with `GET /health/live` (process only — no dependency checks, or a database blip causes a restart loop) and `GET /health/ready` (per-dependency breakdown), both exempt from rate limiting and load shedding
- [X] T049 [P] Write `/server/tests/ops/health.test.js` asserting liveness stays up when a dependency is down and readiness reports the failing dependency by name (FR-050)
- [X] T050 [P] Create `/server/src/scripts/keys-generate.js` producing the Ed25519 keypair for token signing
- [X] T051 [P] Create `/server/src/scripts/seed-dev.js` seeding one superadmin, one department admin, and one active member for local validation

**Checkpoint**: the server boots, serves both health routes, logs a correlated request with credentials redacted, returns problem+json on error, and **fails to start** if a route is registered without a posture or if a budget is misconfigured. Validate with quickstart scenarios **A1–A4**.

---

## Phase 3: User Story 1 - Only the right principal reaches a gated surface (Priority: P1) 🎯 MVP

**Goal**: Members and staff sign in and reach exactly what their account entitles them to. Permission changes take effect on the next request. A department admin cannot escalate to superadmin.

**Independent Test**: Issue tokens for each principal kind and attempt every route class with each; confirm the permitted set matches the declared matrix exactly, and that revoking a permission or a session takes effect on the next request.

> **Pulled forward from US3 by design**: the credential rate-limit buckets (T086–T088). The spec's US3 dependency note makes this explicit — an unthrottled sign-in endpoint is a security defect, not a resilience nicety.

### Tests for User Story 1

> Write these first and confirm they fail before implementing.

- [X] T052 [P] [US1] Write `/server/tests/auth/claims.test.js` asserting the access-token claim key set is **exactly** `sub, sid, aud, typ, jti, iat, exp` — no permissions, no membership tier, no email (FR-006, FR-013)
- [X] T053 [P] [US1] Write `/server/tests/authz/matrix.test.js` as a **data table**, one row per route class × principal kind, asserting zero permitted combinations outside the declared matrix (SC-002)
- [X] T054 [P] [US1] Write `/server/tests/authz/object-guards.test.js` asserting a department admin holding **all five flags** on `admins` is still refused when the target row is an admin or superadmin (FR-009)
- [X] T055 [P] [US1] Write `/server/tests/authz/revocation.test.js` asserting a permission revoked by a superadmin is refused on the target's **very next** request, with no re-login and no wait for token expiry (SC-003)
- [X] T056 [P] [US1] Write `/server/tests/authz/audience.test.js` asserting a member token on a staff route fails at token verification, before any handler runs (FR-003)
- [X] T057 [P] [US1] Write `/server/tests/auth/sessions.test.js` asserting a second sign-in revokes the first session as `superseded`, and that two concurrent sign-ins resolve deterministically through the partial unique index (FR-004)
- [X] T058 [P] [US1] Write `/server/tests/auth/refresh-rotation.test.js` asserting rotation on every refresh and that a **replayed** token terminates the whole lineage, writes an audit record, and returns 401 (FR-005)
- [X] T059 [P] [US1] Write `/server/tests/auth/status-gates.test.js` asserting Locked, Inactive, and Ex-member accounts are each refused with their §3.2 remedy and that **no token is issued** in any case (FR-010)
- [X] T060 [P] [US1] Write `/server/tests/auth/passwords.test.js` asserting argon2id verification, and that a legacy MD5 value is **never** accepted (FR-014)
- [X] T061 [P] [US1] Write `/server/tests/auth/otp.test.js` asserting the 5-attempt ceiling invalidates the challenge, the 5-minute expiry, and that a `deviceId` mismatch returns `invalid-otp` rather than a distinct error (FR-012)
- [X] T062 [P] [US1] Write `/server/tests/auth/device-approval.test.js` asserting a new device has no approval and routes to re-approval, since the primary key includes `device_id` (§12.6)
- [X] T063 [P] [US1] Write `/server/tests/auth/non-enumeration.test.js` asserting unknown-email and wrong-password responses are identical in body and status, and that the dummy-hash verification path **executes** for an unknown account (assert via a spy or counter, not elapsed wall-clock time, which is too flaky for CI); record the timing comparison as a separate benchmark with a stated tolerance
- [X] T064 [P] [US1] Write `/server/tests/auth/csrf.test.js` asserting a cookie-bearing state-changing request without a valid CSRF token is refused, and that bearer clients are exempt

### Schema

- [X] T065 [P] [US1] Create `/server/migrations/005_members.sql` with the identity and status columns from [data-model.md §1](./data-model.md) — **including `mobile` and `mobile_verified_at`**, without which FR-012's out-of-band code has nowhere to go — plus the `password_reset_tokens` table, plus a `BEFORE DELETE` trigger that raises, since §12.4 forbids member deletion and a trigger makes the rule survive an ad-hoc query
- [X] T066 [P] [US1] Create `/server/migrations/006_admin_users_and_permissions.sql` with the five-flag matrix keyed `(admin_user_id, module)` and a trigger enforcing that **at least one active superadmin** always exists
- [X] T067 [US1] Create `/server/migrations/007_sessions_and_refresh_tokens.sql` including the partial unique index `one_active_session_per_account ON sessions (account_id, account_kind) WHERE revoked_at IS NULL` — this constraint *is* FR-004
- [X] T068 [P] [US1] Create `/server/migrations/008_otp_and_device_approvals.sql` with hashed OTP codes and `device_approvals` keyed `(member_id, device_id)`

### Shared contracts

- [X] T069 [P] [US1] Create `/packages/contracts/src/auth.js` with the Zod request and response schemas for every endpoint in [auth-api.md](./contracts/auth-api.md)

### Credential handling

- [X] T070 [P] [US1] Create `/server/src/auth/passwords.js` with argon2id hashing at the OWASP baseline (19 MiB, 2 iterations, parallelism 1) and a dummy-hash verification path so a missing account costs the same time as a wrong password
- [X] T071 [US1] Add the legacy forced-reset path to `/server/src/auth/passwords.js`: a `NULL` hash or `password_reset_required` refuses sign-in and returns the reset outcome — unsalted MD5 is treated as already public and never verified (FR-014)
- [X] T072 [P] [US1] Create `/server/src/auth/tokens.js` minting EdDSA access tokens with the exact documented claim set and generating opaque 256-bit refresh tokens, storing **only** their SHA-256 hash
- [X] T073 [US1] Create `/server/src/auth/sessions.js` implementing single-active-session sign-in as one transaction (revoke active → insert new → issue refresh → audit → update `last_login_at`), handling the unique-index violation deterministically
- [X] T074 [US1] Add refresh rotation and reuse detection to `/server/src/auth/sessions.js` per the table in [data-model.md §3](./data-model.md): a consumed token revokes the session as `token_reuse` and deletes the lineage
- [X] T075 [US1] Add the Redis `sid` denylist to `/server/src/auth/sessions.js` (`SETEX denylist:sid:<id> 600 1` on revocation) so entries expire with the access-token lifetime and the set stays small
- [X] T076 [P] [US1] Create `/server/src/auth/otp.js` issuing hashed 4-digit codes bound to `device_id`, with the attempt ceiling and 5-minute expiry that are what actually make a 4-digit code safe

### Authentication and authorization plumbing

- [X] T077 [US1] Create `/server/src/plugins/09-jwt.js` registering `@fastify/jwt` with EdDSA verification reading from **either** the `gwc_at` cookie or an `Authorization` header, with 30 s clock-skew leeway — one verification path for both faces
- [X] T078 [US1] Create `/server/src/plugins/10-auth.js` resolving `request.principal` from the token, verifying `aud` against the route's declared audience, and checking the `sid` denylist on every request
- [X] T079 [US1] Register `@fastify/cookie` and `@fastify/csrf-protection` in `/server/src/app.js`, with `SameSite=Lax` on the access cookie and `SameSite=Strict` scoped to `/auth/refresh` on the refresh cookie
- [X] T080 [P] [US1] Register `@fastify/cors` in `/server/src/app.js` with an explicit origin allowlist, never `*` on a credentialed route
- [X] T081 [US1] Create `/server/src/authz/permissions.js` resolving the permission snapshot with a 30 s TTL **and explicit invalidation** on any write to `admin_permissions` or to an account's `is_active`/`is_admin`/`is_superadmin` — invalidation is the mechanism, the TTL only a backstop (FR-006)
- [X] T082 [US1] Create `/server/src/authz/require-permission.js` as the Layer 1 `preHandler`: superadmin bypass, then the declared module flag, with an audit write on denial (FR-007, FR-008, FR-015)
- [X] T083 [US1] Create `/server/src/authz/object-guards.js` with `guardAdminTarget` enforcing FR-009 **inside the handler's transaction**, after the target row is loaded — a concurrent promotion must not slip between check and write
- [X] T084 [US1] Add the remaining object guards to `/server/src/authz/object-guards.js` per [rbac-model.md §5](./contracts/rbac-model.md): self-demotion, last-superadmin, member soft-delete, member-owned content
- [X] T085 [US1] Add the member-side gates to `/server/src/plugins/10-auth.js`: status, email confirmed, device approved, and per-member permission flags (FR-010, FR-011, FR-012)

### Credential abuse limits (US3 slice, required here)

- [X] T086 [US1] Add the `sign-in-ip` and `sign-in-account` buckets to `/server/src/config/rate-limits.js`, both fail-closed and both checked — either alone leaves a real attack open (SC-013)
- [X] T087 [P] [US1] Add the `otp-send` (keyed on **phone number**, since each send costs money), `otp-verify`, `password-reset`, and `refresh` buckets to `/server/src/config/rate-limits.js`
- [X] T088 [P] [US1] Write `/server/tests/resilience/rate-limit-credentials.test.js` asserting refusal in **both** directions — many addresses against one account, one address against many accounts — each with `Retry-After` (SC-013)

### Endpoints

- [X] T089 [US1] Create `/server/src/auth/routes.js` with `POST /auth/sign-in` returning the seven documented outcomes, masking `sentTo`, and issuing no token on any status gate
- [X] T090 [US1] Add `POST /auth/verify-otp` and `POST /auth/otp/resend` to `/server/src/auth/routes.js`
- [X] T091 [US1] Add `POST /auth/refresh` and `POST /auth/sign-out` to `/server/src/auth/routes.js`, with sign-out **idempotent** so a client retry after a network failure does not see an error
- [X] T092 [US1] Add `GET /auth/me` to `/server/src/auth/routes.js` returning capabilities from the snapshot and `entitlement: null` from a `resolveEntitlement()` stub — no membership-card table is in scope, so the point-of-use contract is fixed here and the card feature supplies the query — with `Cache-Control: private, no-store`
- [X] T093 [US1] Add `POST /auth/password-reset/request` and `/confirm` to `/server/src/auth/routes.js`, always returning 202 regardless of account existence, and revoking **all** sessions on confirm
- [X] T094 [US1] Declare `config.auth` **and an explicit Zod response schema** on every route in `/server/src/auth/routes.js`, and backfill `/server/src/ops/health.js`, so the T041 startup gate passes — Constitution Principle VI requires the response schema before the route ships, not in a later phase

### Integration with US2

- [X] T095 [US1] Create `/server/src/seo/staff-routes.js` exposing gated edit endpoints for `seo_metadata` fields, requiring the flag on **both** the `seo` module and the record's own module (FR-020, FR-021)
- [X] T096 [US1] Add automatic 301 registration to `/server/src/seo/staff-routes.js`: a slug change writes the old slug into `legacy_redirects`, so accumulated search equity is not silently discarded (§12.12)
- [X] T097 [P] [US1] Write `/server/tests/seo/staff-edit.test.js` asserting the dual-permission requirement and that a slug change creates the 301 record
- [X] T098 [US1] Add the gated-surface response hook to `/server/src/plugins/02-security-headers.js` setting `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, nofollow` on every non-public surface (FR-025)
- [X] T099 [P] [US1] Write `/server/tests/seo/crawl-posture-gated.test.js` asserting every gated surface in the §10.1 table is both access-refused **and** marked non-indexable (SC-008, gated half)

**Checkpoint**: each principal kind reaches exactly its declared route set; a revoked permission is refused on the next request; a second sign-in terminates the first; a replayed refresh kills the lineage; a suspended member cannot sign in. Validate with quickstart **C1–C8**.

---

## Phase 4: User Story 2 - Public content is found, previewed truthfully, and never soft-404s (Priority: P2)

**Goal**: Public pages deliver real content in the first response with unique, accurate metadata and structured data that matches live state — and any URL that does not exist returns an honest 404.

**Independent Test**: Fetch each public route class with JavaScript disabled and with a preview-bot user agent; assert real content, unique metadata, valid structured data, and correct status codes.

> **Depends on US1 for nothing.** Public routes declare `{ audience: 'public' }` against the Foundational registry (T041), which needs no auth implementation. The gated half of the SC-008 sweep lives in US1 (T099), since gated routes only exist there.

### Tests for User Story 2

- [X] T100 [P] [US2] Create `/server/tests/fixtures/bad-paths.js` with ≥50 known-bad paths: `/nonsense`, `/wp-login.php`, `/.env`, `/index.php`, `/partners/deleted`, plus casing, trailing-slash, and query-string variants
- [X] T101 [P] [US2] Write `/server/tests/seo/soft-404.test.js` asserting **every** fixture path returns 404 and that the SPA shell is never served as a fallback (SC-004)
- [X] T102 [P] [US2] Write `/server/tests/seo/rendering.test.js` asserting every public route class returns its meaningful content in the raw response body with no JavaScript executed (SC-005)
- [X] T103 [P] [US2] Write `/server/tests/seo/build-page-meta.test.js` covering staff-override precedence, HTML escaping of a name containing a quote, required image dimensions and alt, single site-name suffix, and stricter-wins robots resolution
- [X] T104 [P] [US2] Write `/server/tests/seo/uniqueness.test.js` asserting zero duplicate titles, descriptions, or canonical URLs across every URL in the generated sitemap (SC-006)
- [X] T105 [P] [US2] Write `/server/tests/seo/structured-data.test.js` asserting each JSON-LD document validates and that `Event.offers.availability` **flips when registration closes** and a lapsed partner stops emitting `LocalBusiness` (SC-007)
- [X] T106 [P] [US2] Write `/server/tests/seo/sitemap.test.js` asserting a partner lapsing past its grace period disappears with **no staff action**, and that `lastmod` is the record's real `updated_at` (SC-008)
- [X] T107 [P] [US2] Write `/server/tests/seo/canonical.test.js` asserting non-canonical host and scheme variants 301 to the canonical origin, and that legacy table entries 301 correctly
- [X] T108 [P] [US2] Write `/server/tests/seo/og-tags.test.js` asserting the full OG and Twitter tag set is present with absolute URLs and explicit image dimensions
- [X] T109 [P] [US2] Write `/server/tests/seo/hreflang.test.js` asserting alternates are **reciprocal** and `x-default` points at the German version — a one-directional `hreflang` is ignored and the translations then compete as duplicates

### Schema and shared contracts

- [X] T110 [P] [US2] Create `/server/migrations/009_legacy_redirects.sql` with `legacy_path` as the primary key and a `status` column allowing 301 or 410
- [X] T111 [P] [US2] Create `/packages/contracts/src/seo.js` exporting the `PageMeta` shape and the structured-data document shapes

### The metadata resolver

- [X] T112 [US2] Create `/server/src/seo/surfaces.js` as the **single** encoding of the §10.1 table — the one source driving route postures, `robots.txt`, and the `X-Robots-Tag` header
- [X] T113 [US2] Create `/server/src/seo/build-page-meta.js` as a **pure** function returning the full `PageMeta` from [seo-delivery.md §1](./contracts/seo-delivery.md)
- [X] T114 [US2] Add the internal rules to `/server/src/seo/build-page-meta.js`: staff-override precedence, absolutisation against the canonical origin, required image dimensions and alt, word-boundary description truncation, single site-name suffix, HTML escaping, stricter-wins robots, and selection of the `large` WebP variant from `asset_variants` for `og:image` (preview bots expect roughly 1200×630)
- [X] T115 [US2] Create `/server/src/seo/structured-data.js` emitting `Organization`, `LocalBusiness`, `Event`, `Article`, and `BreadcrumbList` — **computed per request from live state**, never cached, because §10.4 makes a stale copy a factual misstatement to members

### Crawl control

- [X] T116 [US2] Create `/server/src/seo/sitemap.js` generating `GET /sitemap.xml` from the live inclusion predicate (published ∧ indexable ∧ surface-indexed ∧ partner-in-contract), with real `lastmod`, cached 1 h and invalidated on publish
- [X] T117 [P] [US2] Create `/server/src/seo/robots.js` generating `GET /robots.txt` **from `surfaces.js`**, so a new gated surface is disallowed by construction rather than by remembering to edit a static file
- [X] T118 [P] [US2] Delete `/client/public/robots.txt` and `/client/public/sitemap.xml`, now superseded — leaving them would create a second, silently diverging source

### Status-code correctness — the headline fix

- [X] T119 [US2] Register `@fastify/static` in `/server/src/app.js` with **`wildcard: false`** so it serves only files that exist
- [X] T120 [US2] Add `setNotFoundHandler` to `/server/src/plugins/14-error-handler.js` returning a real **404** — a rendered `noindex` page for HTML, problem+json for API — replacing the `reply.sendFile('index.html')` catch-all that returned HTTP 200 for every unknown path (FR-017, §12.13)
- [X] T121 [US2] Create `/server/src/plugins/03-canonical-origin.js` as an `onRequest` hook 301ing any non-canonical host, scheme, casing, or trailing-slash variant **before routing** (FR-028)
- [X] T122 [US2] Create `/server/src/plugins/04-legacy-redirects.js` serving table-driven 301s from `legacy_redirects` — mechanism and tests ship now, the table is populated when the club supplies its inventory (plan.md Risk 5)

### Public rendering

- [X] T123 [US2] Create `/server/src/public/templates/layout.js` rendering `<html lang>`, the full head from a `PageMeta`, JSON-LD blocks, and reciprocal `hreflang` alternates, with **escaped** interpolation throughout
- [X] T124 [P] [US2] Create `/server/src/public/templates/partner.js` and `outlet.js` rendering listing content with address, hours, and discount
- [X] T125 [P] [US2] Create `/server/src/public/templates/event.js` rendering title, date, venue and description, kept separate from the member-only registration flow (§4)
- [X] T126 [P] [US2] Create `/server/src/public/templates/article.js` and `legal.js`
- [X] T127 [US2] Create `/server/src/public/routes.js` registering the six public route classes, each resolving its record, calling `buildPageMeta`, rendering its template, and declaring `{ audience: 'public' }` and an explicit response schema (Principle VI)
- [X] T128 [US2] Serve the feature-001 coming-soon page through `/server/src/public/routes.js` at `/`, whose pre-rendered boot shell already satisfies FR-016
- [X] T129 [US2] Return a real 404 from `/server/src/public/routes.js` when a slug resolves to no record, and the configured disposition for a lapsed partner — default retained-but-non-indexed (FR-031)

### Performance and caching

- [X] T130 [P] [US2] Register `@fastify/etag` and `@fastify/compress` in `/server/src/app.js`
- [X] T131 [US2] Add per-surface `Cache-Control` in `/server/src/public/routes.js` and `Vary: Accept-Encoding, Accept-Language` — `Vary` on language is load-bearing, or a shared cache serves the German page to an English request
- [X] T132 [P] [US2] Add the `public-read` bucket (generous, fail-open, verified-crawler allowlist) to `/server/src/config/rate-limits.js` — a 429 to a crawler would undermine the partner visibility the club sells

**Checkpoint**: public pages return real content with JavaScript disabled, share previews render from HTML alone, unknown URLs 404, and the sitemap tracks live publication state. Validate with quickstart **B1–B8**.

---

## Phase 5: User Story 3 - Media is stored once and served at the right size (Priority: P3)

**Goal**: Uploads are validated by content, stripped of location metadata, and derived into the sizes and formats actually delivered — so a phone receives tens of kilobytes instead of the multi-megabyte original, and every reference carries explicit dimensions.

**Independent Test**: upload a representative photograph and a short video; confirm derivatives exist at every breakpoint with recorded dimensions and byte sizes, that a phone-width layout receives a small fraction of the original, and that a file whose extension disagrees with its content is refused.

> **Governs Constitution Principle VI.** This phase exists because the original design violated it — there was no media pipeline, so "clients MUST NOT be served an unoptimized original" had no implementation. §10.9 had already required images "served in appropriate sizes and formats with explicit dimensions".

> **Depends only on Foundational.** `assets` and `asset_variants` are created there (T037) because US2 reads variants for `og:image` while this phase writes them. `config/breakers.js` and `plugins/13-breakers.js` are shared with US4 — whichever phase runs first creates them.

### Tests for User Story 3

- [X] T133 [P] [US3] Write `/server/tests/media/validation.test.js` asserting a JPEG named `.png` is typed from its bytes and a mismatched extension is refused (SC-021, FR-052)
- [X] T134 [P] [US3] Write `/server/tests/media/bomb.test.js` asserting a small file declaring an extreme pixel count is refused **before** decode, not after memory is consumed (FR-053)
- [X] T135 [P] [US3] Write `/server/tests/media/metadata-strip.test.js` asserting a GPS-bearing photograph yields an original and derivatives with zero location metadata (SC-020, FR-054)
- [X] T136 [P] [US3] Write `/server/tests/media/derivatives.test.js` asserting every breakpoint exists with recorded dimensions and bytes, and that a 300 px source produces **no upscaled** variant (FR-056, FR-061)
- [X] T137 [P] [US3] Write `/server/tests/media/formats.test.js` asserting WebP is primary, PNG is the fallback only for sources with alpha, and JPEG otherwise (FR-057)
- [X] T138 [P] [US3] Write `/server/tests/media/compression.test.js` asserting a 2 MB source photograph yields `medium` ≤ 60 KB and `thumb` ≤ 8 KB (SC-019)
- [X] T139 [P] [US3] Write `/server/tests/media/video-async.test.js` asserting upload returns 202 `processing`, derivatives and poster appear, and a failed job sets `failed` with a reason rather than leaving a stuck `processing` row (FR-058, FR-059)
- [X] T140 [P] [US3] Write `/server/tests/media/no-original-served.test.js` asserting no public page or API response references a stored original's URL (SC-018, FR-060)
- [X] T141 [P] [US3] Write `/server/tests/media/immutability.test.js` asserting a variant URL is byte-identical across fetches and carries `immutable` plus `nosniff` (FR-062)
- [X] T142 [P] [US3] Write `/server/tests/media/quota-and-breaker.test.js` asserting the per-account stored-byte quota and `upload` bucket both refuse, and that with the generator failing **zero** assets are recorded `ready` (FR-063)
- [X] T143 [P] [US3] Write `/server/tests/media/dedupe.test.js` asserting two byte-identical uploads store one copy and that deleting one leaves the other's bytes intact

### Storage and validation

- [X] T144 [US3] Create `/server/src/media/storage.js` with an S3-compatible driver and a local-disk driver behind one interface, keyed by content hash so identical bytes store once
- [X] T145 [US3] Create `/server/src/media/validate.js` applying the ordered checks from [media-pipeline.md §4](./contracts/media-pipeline.md): streamed 25 MB cap, `file-type` magic-byte inspection, MIME allowlist, and a **pre-decode** dimension bound backed by `sharp`'s `limitInputPixels`
- [X] T146 [US3] Refuse SVG outright in `/server/src/media/validate.js` — an SVG can carry script, so storing and serving one from the club's origin is a stored-XSS primitive
- [X] T147 [P] [US3] Create `/server/src/media/strip-metadata.js` removing EXIF, XMP, and ICC data — GPS coordinates in a member's photograph are a direct §10.1 PII concern (FR-054)

### Derivative generation

- [X] T148 [US3] Create `/server/src/media/derive-image.js` producing `thumb` 160 / `small` 400 / `medium` 800 / `large` 1600 px via `sharp`, aspect preserved, **never upscaled**, WebP primary with PNG for alpha sources and JPEG otherwise (FR-056, FR-057)
- [X] T149 [P] [US3] Create `/server/src/media/queue.js` registering the `pg-boss` work queue for video derivatives — event-triggered work, distinct from `croner`'s time-triggered scheduling in US5
- [X] T150 [US3] Create `/server/src/media/derive-video.js` spawning `ffmpeg` directly via `node:child_process` with a hard kill at its budget, producing WebM plus a WebP poster frame — not `fluent-ffmpeg`, whose latest release is unmaintained (FR-058)
- [X] T151 [US3] Add the media policy to `/server/src/config/breakers.js` and `/server/src/plugins/13-breakers.js` (creating them if this phase runs before US4): 6 s image, 300 s video job, **fail closed** so no asset is recorded `ready` on failure (FR-063)
- [X] T152 [US3] Create `/server/src/db/counters.js` providing the transactional counter primitive — reserve against a bounded counter under a row lock inside the caller's transaction — which FR-043 requires and every later quota feature builds on

### Endpoints and delivery

- [X] T153 [US3] Create `/packages/contracts/src/media.js` with the Zod request and response schemas from [media-pipeline.md](./contracts/media-pipeline.md), including the explicit response schema Principle VI requires
- [X] T154 [US3] Create `/server/src/media/routes.js` with `POST /media` under an 8 s `media-upload` budget, returning **201 with every variant URL** for images and **202 `processing`** for video, and probing intrinsic dimensions synchronously in both cases (FR-055, FR-059)
- [X] T155 [US3] Add `GET /media/:id` and `DELETE /media/:id` to `/server/src/media/routes.js`, gated by ownership or module flag, removing stored bytes only when no other asset shares the checksum
- [X] T156 [US3] Add `GET /media/:checksum/:variant.:ext` to `/server/src/media/routes.js` with `Cache-Control: public, max-age=31536000, immutable`, `Content-Disposition: inline`, and `X-Content-Type-Options: nosniff` (FR-062)
- [X] T157 [US3] Add the `upload` bucket (30/hour per account, fail-closed) to `/server/src/config/rate-limits.js` and enforce the per-account stored-byte quota through `/server/src/db/counters.js` (FR-063)
- [X] T158 [US3] Switch `/server/src/public/templates/layout.js` and the per-type templates to `<picture>` with a `srcset` across the breakpoints and explicit `width`/`height`, so the browser picks the smallest sufficient variant and reserves the box before bytes arrive (FR-060, SC-018)

**Checkpoint**: a 2 MB photograph uploads and returns every variant URL with recorded dimensions; a phone-width layout receives tens of kilobytes; a mismatched extension and a decompression bomb are both refused; a GPS-bearing photograph stores with no location metadata. Validate with quickstart **M1–M8**.

---

## Phase 6: User Story 4 - The API degrades predictably instead of hanging or falling over (Priority: P4)

**Goal**: A failed or slow dependency produces a fast, clear failure, stops being hammered, and does not affect unrelated requests.

**Independent Test**: Drive each failure mode against a stub dependency — hang, slow response, error storm, request flood — and assert response time, status code, and recovery against the declared budgets.

> The credential buckets shipped in US1 (T086–T088). This phase completes the remaining buckets, the outbound isolation, and shutdown.

### Tests for User Story 3

- [ ] T159 [P] [US4] Write `/server/tests/resilience/timeouts.test.js` asserting a request against a hung stub completes within 110% of its declared budget and that the underlying query is **cancelled**, not merely abandoned (SC-009)
- [ ] T160 [P] [US4] Write `/server/tests/resilience/isolation.test.js` asserting that with the payment stub hung, p99 for routes not touching it stays within 20% of baseline (SC-010)
- [X] T161 [P] [US4] Write `/server/tests/resilience/breaker.test.js` asserting closed → open at threshold, **zero** calls reaching the dependency while open, and a single half-open probe closing it on success (SC-011)
- [ ] T162 [P] [US4] Write `/server/tests/resilience/breaker-errorfilter.test.js` asserting 20 consecutive `CARD_DECLINED` responses leave the payment circuit **closed** — without this, a busy evening of legitimate declines takes payments down for everyone (SC-012)
- [ ] T163 [P] [US4] Write `/server/tests/resilience/crawler-budget.test.js` asserting a normal-rate crawl over every public route sees **zero** 429s (SC-014)
- [ ] T164 [P] [US4] Write `/server/tests/resilience/trust-proxy.test.js` asserting limits key on the forwarded address at the configured hop depth and that a forged extra hop does not bypass the limit (FR-040)
- [ ] T165 [P] [US4] Write `/server/tests/resilience/client-abort.test.js` asserting a client disconnect propagates cancellation into the query (FR-034)
- [ ] T166 [P] [US4] Write `/server/tests/resilience/shutdown.test.js` asserting readiness fails **before** the drain begins and that zero in-flight requests are dropped within the drain period (SC-015)
- [ ] T167 [P] [US4] Write `/server/tests/resilience/shedding.test.js` asserting 503 with `Retry-After` under induced event-loop delay, and that health routes stay exempt

### Outbound dependency isolation

- [X] T168 [US4] Create `/server/src/integrations/http-client.js` configuring an `undici` dispatcher per dependency with its own `headersTimeout` and `bodyTimeout` (timeout layer 4)
- [X] T169 [US4] Create **or extend** `/server/src/config/breakers.js` (the media phase creates it if that phase runs first) holding the per-dependency policy table from [resilience.md §2](./contracts/resilience.md), with a startup check that **every dependency declares a fallback** (FR-037)
- [X] T170 [US4] Add the shared `errorFilter` to `/server/src/config/breakers.js` excluding all 4xx and `CARD_DECLINED` from the failure count — a business rejection is not a dependency failure (FR-036)
- [X] T171 [US4] Create **or extend** `/server/src/plugins/13-breakers.js` instantiating one `opossum` breaker per dependency and exposing them on the instance
- [X] T172 [P] [US4] Create `/server/src/integrations/payments.js` with its stub, **fail-closed**: no fallback may let checkout proceed, or the club hands out cards and event seats for free (FR-037)
- [X] T173 [US4] Add the deterministic idempotency reference to `/server/src/integrations/payments.js` so a retry after recovery reuses the same invoice rather than generating a second (FR-038, §12.5)
- [X] T174 [P] [US4] Create `/server/src/integrations/sms.js` with its stub and a refuse-with-retry-later fallback
- [X] T175 [P] [US4] Create `/server/src/integrations/mail.js` with its stub and an enqueue-for-later fallback keyed by message id
- [X] T176 [P] [US4] Create `/server/src/integrations/geocoding.js` with its stub and a save-without-coordinates fallback
- [X] T177 [US4] Wrap the Redis client in `/server/src/plugins/06-redis.js` in a 250 ms breaker, since the limiter's own dependency must not become the outage

### Deadline propagation

- [X] T178 [US4] Propagate `request.signal` from `/server/src/plugins/12-deadline.js` into every `pg` query and `undici` request, so expiry cancels real work
- [X] T179 [US4] Apply the per-route-class deadlines from `/server/src/config/budgets.js` to every registered route, returning 503 `request-deadline-exceeded` on expiry (FR-032)
- [X] T180 [P] [US4] Add an `onTimeout` hook in `/server/src/plugins/12-deadline.js` recording a metric only — the socket is already hung up, so it cannot respond

### Remaining limits and self-protection

- [X] T181 [US4] Add the `member-api`, `admin-api`, and `write-heavy` buckets to `/server/src/config/rate-limits.js` with their documented `skipOnError` values
- [X] T182 [US4] Configure `trustProxy` in `/server/src/app.js` from the validated hop count — never `true`, which would let a client forge `X-Forwarded-For` and bypass every limit (FR-040, Risk 4)
- [X] T183 [US4] Add `RateLimit-*` and `Retry-After` headers to refusals in `/server/src/plugins/07-rate-limit.js`, returning the problem+json envelope (FR-042)
- [X] T184 [US4] Create `/server/src/plugins/08-under-pressure.js` registering `@fastify/under-pressure` with event-loop and heap thresholds, exempting the health routes, and backing readiness (FR-045)
- [X] T185 [US4] Add `close-with-grace` to `/server/src/server.js` in the documented order: fail readiness **first**, then stop accepting, then drain 15 s, then close the pool and Redis (FR-046)

**Checkpoint**: an induced hang is contained within budget without moving unrelated p99; the breaker opens, probes and recovers; a declined payment leaves it closed; a normal crawl sees zero 429s; SIGTERM drops nothing. Validate with quickstart **D1–D9**.

---

## Phase 7: User Story 5 - An operator can tell what happened (Priority: P5)

**Goal**: A failure at any layer can be traced end to end, with no member PII or credentials in the trail, and scheduled job runs are auditable.

**Independent Test**: Issue a request that fails at each layer, then confirm a correlated log trail exists for each, with sensitive fields redacted and a stable request identifier returned to the caller.

### Tests for User Story 4

- [ ] T186 [P] [US5] Write `/server/tests/ops/audit.test.js` asserting sign-ins, denials, permission changes, session terminations, and refresh replays each produce a record carrying principal, target, required permission, and request id (FR-015)
- [ ] T187 [P] [US5] Write `/server/tests/ops/audit-append-only.test.js` asserting the application role cannot UPDATE or DELETE `audit_log`
- [ ] T188 [P] [US5] Write `/server/tests/ops/jobs.test.js` asserting a run records start, end, and outcome, that a disabled job does not run, and that a crashed run leaves a `NULL` finish rather than a false success (FR-051)
- [ ] T189 [P] [US5] Write `/server/tests/ops/correlation.test.js` asserting every log line for a request shares one identifier, that it is returned to the caller, and that a client-supplied `X-Request-Id` is reused after validation (FR-047)

### Implementation

- [X] T190 [P] [US5] Create `/server/migrations/010_job_definitions_and_runs.sql` per [data-model.md §5](./data-model.md)
- [X] T191 [US5] Extend `/server/src/ops/audit.js` with the query helpers staff need — by principal, by target, by required permission, by time window
- [X] T192 [US5] Create `/server/src/ops/jobs.js` scheduling with `croner`, honouring `job_definitions.enabled`, and writing a `job_runs` row for every run including failures (FR-051)
- [X] T193 [P] [US5] Add the platform jobs to `/server/src/ops/jobs.js`: expired-session cleanup, orphan-session pruning (`sessions.account_id` is polymorphic with no FK, so an orphan is representable), OTP challenge cleanup, denylist pruning, sitemap cache invalidation
- [X] T194 [US5] Add metrics emission to `/server/src/ops/metrics.js` for circuit-state transitions, rate-limit refusals per bucket, and timeouts per route class
- [X] T195 [US5] Extend `/server/src/ops/health.js` so readiness reports each dependency individually, including migration currency and shedding state (FR-050)
- [X] T196 [US5] Register `@fastify/swagger` in `/server/src/app.js` and `fastify-type-provider-zod` so OpenAPI is generated from the shared Zod schemas rather than maintained as a third, separately-wrong description
- [X] T197 [P] [US5] Audit that every registered route in `/server/src/` has an explicit Zod response schema and fail the build on any that does not — the schemas ship with their own stories (T094, T127, T153); this task is the gate that stops a later route skipping one

**Checkpoint**: a failure at each layer produces a correlated, redacted trail; denials are queryable from the audit table; job runs record start, end, and outcome. Validate with quickstart **Phase E**.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T198 Run every quickstart scenario in `/specs/002-server-platform/quickstart.md` A1 through F and confirm each of SC-001 to SC-017 has a passing named test
- [ ] T199 [P] Run `npm run -w server test:coverage` and close gaps on `/server/src/authz/` and `/server/src/seo/build-page-meta.js`, the two highest-consequence modules
- [ ] T200 [P] Add `/server/src/scripts/verify-seo.js` crawling the generated sitemap for metadata uniqueness, status codes, and structured-data validity (§10.10)
- [ ] T201 [P] Add `/server/src/scripts/verify-cwv.js` measuring Core Web Vitals against a production build of the public pages (SC-017)
- [ ] T202 [P] Write `/server/README.md` documenting the three deployment preconditions — `TRUST_PROXY`, `CANONICAL_ORIGIN`, `KEEP_ALIVE_TIMEOUT` versus the proxy idle timeout — and why none has a safe default
- [ ] T203 [P] Update `/CLAUDE.md` (or create it) with the workspace layout and the plugin-ordering rule, so the numbering is not undone by a later change
- [ ] T204 Review every open item in `/specs/002-server-platform/plan.md` "Risks & Open Items" and confirm each is either resolved or has a named owner
- [ ] T205 Run `/speckit-analyze` to cross-check `/specs/002-server-platform/spec.md`, `plan.md`, and `tasks.md` for drift before implementation begins

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup — **BLOCKS all user stories**
- **User Stories (Phases 3–7)**: all depend on Foundational only; none depends on another story
- **Polish (Phase 8)**: depends on the stories you intend to ship

### Cross-story notes

Five touch points, each resolved so the stories stay independent:

| Touch point | Resolution |
|---|---|
| `seo_metadata`, `assets`, `asset_variants` | Placed in **Foundational** (T037–T038): US3 writes assets and variants, US2 reads variants for `og:image`, US1 writes SEO overrides |
| `audit_log` + writer | Placed in **Foundational** (T036, T039) because US1 needs it for FR-015 and US5 extends it |
| SC-008 crawl-posture sweep | Split: gated surfaces in US1 (T099, where gated routes exist), public surfaces in US2 (T101–T106) |
| `config/breakers.js` + `plugins/13-breakers.js` | Shared by US3 (media generation) and US4 (outbound dependencies). **Whichever phase runs first creates them**; the other extends. T151, T169 and T171 are all written as create-or-extend |
| `<picture>`/`srcset` in public templates | Templates are built in US2 (T123–T126) and upgraded in US3 (T158). US2 ships correct-but-unoptimized markup; US3 makes it satisfy Principle VI |

Two slices are deliberately delivered outside their own story: credential rate limits (T086–T088) ship with US1 because an unthrottled sign-in is a security defect, and the `db/counters.js` primitive (T152) ships with US3 because the media quota is its first consumer, even though FR-043 states it among the resilience requirements.

### Within each user story

- Tests first; confirm they fail before implementing
- Migrations → credential/domain logic → plugins → routes → integration
- T067 depends on T065–T066 (sessions reference accounts); T073–T075 depend on T072; T082 depends on T081; T114 depends on T113; T148 depends on T144–T145; T150 depends on T149; T157 depends on T152; T158 depends on T148

### Parallel opportunities

- **Setup**: T002, T003, T005–T009, T011 in parallel after T001
- **Foundational**: the migrations T035–T038 in parallel; tests T020, T024, T029, T040, T043, T049 in parallel
- **US1**: all 13 test files T052–T064 in parallel; migrations T065, T066, T068 in parallel; `passwords.js`, `tokens.js`, `otp.js` (T070, T072, T076) in parallel
- **US2**: all 10 test files T100–T109 in parallel; templates T124–T126 in parallel
- **US3 (media)**: all 11 test files T133–T143 in parallel; `strip-metadata.js` (T147) and `queue.js` (T149) alongside the storage and validation work
- **US4 (resilience)**: all 9 test files T159–T167 in parallel; the four integration stubs T172, T174–T176 in parallel
- **US5 (operability)**: all 4 test files T186–T189 in parallel
- Once Foundational completes, **all five stories can run in parallel** across developers

---

## Parallel Example: User Story 1

```bash
# All 13 US1 test files are independent — write them together first:
Task: "Write /server/tests/auth/claims.test.js asserting the exact claim key set"
Task: "Write /server/tests/authz/matrix.test.js as a data table per route class × principal"
Task: "Write /server/tests/authz/object-guards.test.js for the FR-009 escalation guard"
Task: "Write /server/tests/authz/revocation.test.js for next-request refusal"
Task: "Write /server/tests/auth/refresh-rotation.test.js for replay detection"

# Then the independent credential modules:
Task: "Create /server/src/auth/passwords.js with argon2id and dummy-hash timing"
Task: "Create /server/src/auth/tokens.js minting EdDSA access + opaque refresh"
Task: "Create /server/src/auth/otp.js with hashed codes and the attempt ceiling"
```

---

## Implementation Strategy

### Recommended order: Foundational → US2 → US1 → US3 → US4 → US5

The phases above are **numbered** by spec priority, as the template requires. The order worth **executing** them in is the one in plan.md, which puts US2 before US1:

1. **Foundational first, always.** The two startup gates (T041, T019) must exist before routes do, or declaring postures becomes a retrofit across dozens of routes.
2. **US2 next, despite being P2.** It closes a defect that is live in the delivered code — `server.js` returns HTTP 200 for every unknown path — needs no identity model, and is the revenue-bearing half of §10, since partner visibility is a paid deliverable.
3. **US1 next.** It is P1 and the largest phase; nothing member- or staff-facing ships without it.
4. **US3 (media) next.** It closes the Principle VI violation and completes US2: the public pages built there carry partner logos, article headers, and galleries, and serving originals on them costs both SC-017's Core Web Vitals target and the visibility the club has sold. It is also the prerequisite for every later feature that accepts an upload.
5. **US4, then US5.** Their value is realised under failure and during incidents respectively.

Both orders are valid — the stories are independent after Foundational — so this is a sequencing preference, not a dependency. The one caveat is US3 and US4 sharing the breaker files (see Cross-story notes).

### MVP options

| Scope | Phases | Delivers |
|---|---|---|
| **Smallest useful** | 1 + 2 + US2 | Correct, discoverable public site with honest status codes. Fixes the live defect. No auth; images still unoptimized. |
| **Spec MVP** | 1 + 2 + US1 | Working access control — the P1 story. Nothing public-facing improves. |
| **Recommended first release** | 1 + 2 + US2 + US1 + US3 | Both halves of externally visible behaviour, **and** the smallest combination that satisfies all six constitution principles |
| **Production-ready** | + US4 + US5 | Required before the platform carries real money or member PII |

The first two rows are **not constitution-compliant**: Principle VI is unsatisfied until US3 lands, so neither is a lawful release under the ratified governance. They are useful checkpoints, not shippable states.

### Incremental delivery

1. Setup + Foundational → gates live, server boots, nothing can regress silently
2. Add US2 → **stop and validate** B1–B8 → deploy; the soft-404 is gone
3. Add US1 → **stop and validate** C1–C8 → deploy; gated surfaces are real
4. Add US3 → validate M1–M8 → deploy; images ship at the right size and Principle VI is satisfied
5. Add US4 → validate D1–D9 → deploy; failures are contained
6. Add US5 → validate Phase E → deploy; incidents are traceable

### Parallel team strategy

Complete Setup + Foundational together — it is shared infrastructure and the gates affect everyone. Then: developer A on US1 (largest), developer B on US2 then US3 (the templates hand off between them), developer C on US4, with US5 folded into whoever finishes first. The five entries in the Cross-story notes table are the only coordination needed — the breaker files are the one place two developers touch the same file.

---

## Notes

- **Do Foundational properly.** The startup gates (T019, T041) are what make SC-001 and FR-033 verifiable rather than aspirational, and they are cheap only while the route table is empty.
- **T120 is the single highest-value task in this list.** It is a handful of lines replacing a catch-all that currently answers every unknown URL with HTTP 200 — the defect §10.6 and §12.13 name explicitly and ask to have regression-tested.
- **T017 is the second.** `requestTimeout` defaults to `0` on the installed Fastify, so a stalled request is held open forever today.
- **T162 protects against a self-inflicted outage.** Without the `errorFilter`, legitimately declined cards trip the payment breaker.
- **T145 and T134 are the upload endpoint's real defence.** A 10 KB PNG can declare 100,000 × 100,000 pixels and decode to tens of gigabytes, so the dimension bound must be read from the header **before** decoding, never after.
- **T151 is fail-closed on purpose.** If derivative generation is down the upload fails; an asset recorded `ready` without its derivatives would be served as an original and violate Principle VI silently.
- Tests marked [P] are separate files with no shared fixtures; run them together.
- Commit after each task or logical group. Stop at any checkpoint to validate a story independently.
- The constitution is still an unfilled template. `/speckit-constitution` before starting is worth the ten minutes — this is the first feature handling credentials, PII, and payment paths.
