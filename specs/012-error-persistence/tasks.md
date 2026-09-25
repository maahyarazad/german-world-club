---

description: "Task list for feature 012: persisted server errors and mobile development logging"
---

# Tasks: Persisted Server Errors and Mobile Development Logging

**Input**: Design documents from `/specs/012-error-persistence/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R9), data-model.md, contracts/server-faults-api.md, contracts/mobile-dev-logging.md, quickstart.md

**Tests**: Included. The constitution requires every touched principle to have a passing automated check ("Every principle is verifiable"), and plan.md's Constitution Check names each one. Write each story's tests first and confirm they fail before implementing.

**Organization**: Grouped by user story. US1 (server faults recorded and findable by request id) and US2 (mobile development logging) are both P1 and independent of each other. US3 (review in the staff console) is P2 and builds on US1's table.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 or US3 (spec.md user stories)
- Paths are repo-relative. Workspaces: `server/`, `client/`, `packages/contracts/`, `expo-client/german-world-club/`.

## Ground rules for every task (from CLAUDE.md)

- Server code is ES-module TypeScript; follow `server/ARCHITECTURE.md` (routes → controller → application).
- Comments explain **why**, especially where the obvious implementation would be wrong.
- Queries reaching a response name their columns explicitly (never `SELECT *`).
- Tests assert behaviour and carry a counter-assertion wherever they could otherwise pass against a server that did nothing. SQL suites use `describe.skipIf(!hasDatabase)` from `server/tests/helpers/db.ts`.
- Problem `detail` stays English; clients branch on `type`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration and shared constants every later phase reads.

- [X] T001 Add `SERVER_FAULTS_PER_MINUTE: int(60)` to the schema in `server/src/config/env.ts` with a comment saying the cap is per instance and why it exists (research R3). Add `SERVER_FAULTS_PER_MINUTE=60` with a one-line explanation to `server/.env.example`, and a row to the configuration table in `server/README.md`.
- [X] T002 [P] Append `'server_faults'` to `MODULES` in `packages/contracts/src/permissions.ts`, with a comment that only `read` is used and why a dedicated module rather than `settings`/`jobs` (research R7).
- [X] T003 [P] Create `packages/contracts/src/server-faults.ts` exporting `ServerFault`, `ServerFaultSummary` (`ServerFault` without `stack`), `ServerFaultListResponse` (`{ items, nextCursor, suppressedLast24h }`), `ServerFaultLookupResponse` (`{ item: ServerFault }`), with `clientRequestId: string | null` on `ServerFault`, exactly as in `specs/012-error-persistence/contracts/server-faults-api.md`. Add the `./server-faults` subpath export to `packages/contracts/package.json`, mirroring the existing `./push` entry.
- [X] T004 [P] Create `packages/contracts/src/request-id.ts` exporting `REQUEST_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/` (a server-generated ULID) and `CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/` (a client correlation id, the former server `SAFE_ID`), each with a comment on what it may and may not be used for (research R10). Add the `./request-id` subpath export to `packages/contracts/package.json`. This is the single definition that resolves analysis finding C1.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The table, its database-enforced invariants, and the pure helpers. US1 and US3 cannot start without these. US2 does not depend on this phase.

**⚠️ CRITICAL**: US1 and US3 work cannot begin until this phase is complete.

- [X] T005 Create `server/migrations/030_server_faults.sql` per `specs/012-error-persistence/data-model.md` §1–§3:
  - `ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'server_faults'`
  - table `server_faults`, with every column CHECK and the indexes: `request_id` is a ULID CHECK plus `UNIQUE`, and `client_request_id` is nullable with the client-id CHECK and a partial index
  - table `server_fault_suppressions`, with primary key `(minute, instance_id)`
  - trigger `server_faults_immutable`: `BEFORE UPDATE` raises `server fault records are never edited`
  - trigger `server_faults_retention_floor` on **both** tables: `BEFORE DELETE` raises unless `OLD.occurred_at` (or `OLD.minute`) is older than `now() - interval '30 days'`
  - a comment that `TRUNCATE` fires no row triggers, and that this is intended for the test reset only
  - no grant rows
- [X] T006 [P] Create `server/src/ops/scrub.ts` exporting the pure `scrubText(text: string, max: number): string`. It replaces email addresses, phone-like digit runs (≥ 7 digits, optional `+`/spaces/dashes), JWT-shaped `xxx.yyy.zzz` base64url strings, and hex/base64 runs ≥ 32 chars with `[redacted]`, then truncates to `max`. Comment why key-based pino redaction cannot see inside free text (research R4).
- [X] T007 [P] Create `server/src/modules/server-faults/application/fingerprint.ts` exporting `fingerprintOf({ errorName, errorCode, method, route, stack })`. It computes the SHA-256 hex of `name|code|method|route|firstAppFrame`, where `firstAppFrame` is the first stack line containing `server/src/`, made relative to `src/`, with `:line:col` stripped (research R5).
- [X] T008 [P] Add a `serverFaults` counter group (`stored`, `suppressed`, `failed`) to `createMetrics()` and `snapshot()` in `server/src/ops/metrics.ts`. Give it the same shape as the existing counters, with methods `serverFaultStored()`, `serverFaultSuppressed()` and `serverFaultFailed()`.
- [X] T009 [P] Add `server_faults` and `server_fault_suppressions` to `HISTORY` in `server/src/seed/tables.ts` (not `NEVER_SEEDED`, which is reserved for live credentials and whose test requires that; this follows feature 011's `push_notifications` precedent), with a comment giving the reasons ("real evidence of real faults — a seeded one is fiction in the one table meant to be trusted", and "a counter of real suppressed faults"). Confirm `server/tests/seed/table-manifest.test.ts` passes.
- [X] T010 [P] Add `resetServerFaults(pool)` to `server/tests/helpers/db.ts`. It runs `TRUNCATE server_faults, server_fault_suppressions`. Comment that `TRUNCATE` bypasses the retention floor on purpose, and that this is the only place allowed to use it.
- [X] T011 [P] Unit tests in `server/tests/server-faults/scrub.test.ts` and `server/tests/server-faults/fingerprint.test.ts`:
  - scrub removes each sensitive pattern and truncates. Counter-assertion: ordinary text such as `duplicate key value violates unique constraint "x"` survives unchanged.
  - fingerprint is stable when only line numbers change and differs when the route or first app frame differs
- [X] T012 Database tests in `server/tests/server-faults/immutability.test.ts` (`skipIf(!hasDatabase)`), using raw SQL:
  - `UPDATE server_faults` is refused
  - `DELETE` of a fresh row is refused
  - counter-assertion: a row inserted with `occurred_at = now() - interval '31 days'` **can** be deleted
  - the same delete-floor checks on `server_fault_suppressions`

### Request identity (research R10). Blocks US1's keying and changes every response.

- [X] T013 Rewrite the client-id cases in `server/tests/http/error-envelope.test.ts` (test first, so it fails against today's code):
  - "reuses a validly-shaped client-supplied request id" becomes: with `x-request-id: client-supplied-1234`, the response `x-request-id` and body `requestId` are a matching ULID (`REQUEST_ID`), **not** the supplied value, and `x-client-request-id: client-supplied-1234` is echoed
  - "ignores a malformed client-supplied request id" additionally asserts no `x-client-request-id` header
  - counter-assertion: with no client header, there is no `x-client-request-id`, and `x-request-id` is still a ULID
- [X] T014 [P] New `server/tests/http/request-id.test.ts` (SC-007). Capture the log stream as `server/tests/ops/logging-redaction.test.ts` does, and send a request carrying `x-request-id: support-ticket-42`. Assert:
  - every captured line of that request has `requestId` equal to the response's ULID, and `clientRequestId: 'support-ticket-42'`, **including** Fastify's own "incoming request" and "request completed" lines
  - no line has `requestId: 'support-ticket-42'`
  - with a database (`skipIf(!hasDatabase)`), an audited request (e.g. a failed sign-in, which writes `audit_log`) stores the ULID in `audit_log.request_id`, never the supplied value
  - two requests sent with the same client id get different, increasing ULIDs
- [X] T015 Rework `server/src/plugins/00-request-context.ts`:
  - `makeGenReqId(nextId)` ignores every inbound header and returns `nextId()`; `app.ts` passes `monotonicFactory()` from `ulid`
  - add `readClientRequestId(raw)`, which returns the header value only if it matches `CLIENT_REQUEST_ID`, else `null`
  - add `makeChildLoggerFactory()`, for Fastify's `childLoggerFactory` option, which merges `{ clientRequestId }` into the bindings when `readClientRequestId(rawReq)` is non-null
  - in the `onRequest` hook, also set `clientRequestId` in the request context, and when it is non-null set `x-client-request-id` on the reply
  - delete `SAFE_ID` and its export, and import `CLIENT_REQUEST_ID` from `@gwc/contracts/request-id`
  - add `clientRequestId` to the request-context store type in `server/src/types/fastify.d.ts`

  Rewrite the header comment: ids are always server-generated, and why (uniqueness, sortability, `audit_log` integrity). Add a comment on why the client value is bound through `childLoggerFactory` and not by reassigning `request.log` (`reply.log` is captured at request creation, so the automatic lines would miss it).
- [X] T016 In `server/src/app.ts`, change `genReqId: makeGenReqId(ulid)` to `genReqId: makeGenReqId(monotonicFactory())` and add `childLoggerFactory: makeChildLoggerFactory()` beside it. Update the imports. Make T013–T014 pass, and confirm `tests/auth/non-enumeration.test.ts`, `tests/marketplace/ownership.test.ts`, `tests/offers/visibility.test.ts` and `tests/resilience/timeouts.test.ts` still pass unchanged.

**Checkpoint**: `npm run -w server migrate` applies `030`; T011–T016 pass; every request id is server-generated.

---

## Phase 3: User Story 1: Look up a server fault by its request id (Priority: P1) 🎯 MVP

**Goal**: Every request answered with `INTERNAL` leaves a durable, scrubbed record, findable by the request id the client received, without changing the response.

**Independent Test**: Make a probe route throw, restart the app, and `GET /admin/server-faults/by-request/:requestId` as a superadmin returns the record with the route pattern and cause. A 404/400/403/429 and a deliberate 503 leave no record (quickstart #1–#8).

### Tests for User Story 1 ⚠️ (write first, confirm they fail)

- [X] T017 [P] [US1] `server/tests/server-faults/record.test.ts` (`skipIf(!hasDatabase)`). Build the app, register a probe route with `config: { auth: { audience: 'public' } }` that throws `new Error('boom')`, and inject a request. Assert:
  - one `server_faults` row with `request_id` equal to the response's `requestId` (a ULID)
  - sent with `x-request-id: client-abc-123`, that row's `client_request_id` is `client-abc-123` and its `request_id` is not
  - `route` is the **pattern** (probe with a `:id` param and a query string; neither the value nor the query appears)
  - status 500 and error name `Error`
  - counter-assertions: requests producing 404, 400 (validation), 403 and 429 add no rows
  - a thrown error carrying `problem: PROBLEMS.REQUEST_DEADLINE_EXCEEDED` and a breaker-open 503 add no rows
- [X] T018 [P] [US1] `server/tests/server-faults/redaction.test.ts` (`skipIf(!hasDatabase)`). A probe route throws an error whose message embeds an email address, a phone number, a JWT-shaped string and a 40-char hex token, and which also carries `detail: 'Key (email)=(a@b.c) already exists'`. Send it with an `authorization` header, a cookie, and a body holding password, code, refreshToken, email and mobile. Scan every column of the stored row and assert none of those values appears. Counter-assertion: the non-sensitive part of the message *is* stored (SC-002).
- [X] T019 [P] [US1] `server/tests/server-faults/db-down.test.ts`. Build the app with a `recordServerFault` whose insert never resolves or always rejects (inject through the decorator's options). Assert the problem response body, status and `x-request-id` are identical to a baseline with recording disabled, that it arrives within the same bound, that `app.metrics.snapshot().serverFaults.failed` increments on rejection, and that the `request failed` log line is still emitted (capture the logger stream as in `server/tests/ops/logging-redaction.test.ts`) (SC-003, FR-004, FR-011).
- [X] T020 [P] [US1] `server/tests/server-faults/burst.test.ts` (`skipIf(!hasDatabase)`). With `SERVER_FAULTS_PER_MINUTE: 5` and an injectable clock, trigger 20 faults in one minute. Assert:
  - exactly 5 rows stored and `serverFaults.suppressed === 15`
  - after the clock advances a minute and one more fault occurs, one `server_fault_suppressions` row with `suppressed = 15`
  - the in-flight cap: with an insert that is held open, the third concurrent fault is suppressed, not queued
  - a second flush of the same minute adds to the existing row rather than inserting a new one
- [X] T021 [P] [US1] `server/tests/server-faults/lookup.test.ts` (`skipIf(!hasDatabase)`). As a superadmin (`createAdmin` with `isSuperadmin`, `bearerFor` from `server/tests/helpers/auth.ts`):
  - `GET /admin/server-faults/by-request/:id` returns `{ item: ServerFault }` with `stack` and `clientRequestId`
  - an unknown well-formed ULID → `404` with type `NOT_FOUND`, body identical in shape to any other 404
  - a malformed id, and a well-formed *client* id that is not a ULID → `400` (`validation-failed`)
  - a staff user without `server_faults.read` → `403`
  - a member token → refused
- [X] T022 [P] [US1] Add rows to `ROUTE_CLASSES` in `server/tests/authz/matrix.test.ts` for `GET /admin/server-faults/by-request/:requestId` (audience `staff`, module `server_faults`, flag `read`). Add a case asserting `POST`, `PATCH`, `PUT` and `DELETE` on it answer `404`.
- [X] T023 [P] [US1] `server/tests/server-faults/prune.test.ts` (`skipIf(!hasDatabase)`): `server-faults.prune` is in `PLATFORM_JOBS`; running its handler deletes a row back-dated 31 days and keeps a fresh one; with the job disabled in the jobs table, a scheduled tick removes nothing (SC-006).

### Implementation for User Story 1

- [X] T024 [US1] Create `server/src/decorators/server-faults.ts` exporting `registerServerFaults(app, { perMinute, clock = Date.now, insert? })` and a testable `createServerFaultRecorder(...)`. It decorates `app.recordServerFault(fault)`, which:
  - takes the allowlisted shape from research R4, including `clientRequestId` (never `request` or the error object)
  - applies `scrubText` (message ≤ 2000, stack ≤ 8000) and `fingerprintOf`
  - enforces the per-minute cap and an in-flight cap of 2
  - inserts inside `BEGIN; SET LOCAL statement_timeout = 1000; INSERT …; COMMIT` with explicit columns and `instance_id = ${hostname}:${pid}`
  - on minute rollover, flushes suppressions with `INSERT … ON CONFLICT (minute, instance_id) DO UPDATE SET suppressed = server_fault_suppressions.suppressed + EXCLUDED.suppressed`
  - bumps `app.metrics.serverFault*`, logs `warn` once per failure burst, and **never throws**
  - exposes `flushSuppressions()` for the prune job

  Comment each bound with its reason (research R3: pool `max: 10`, `connectionTimeoutMillis`).
- [X] T025 [US1] Wire it into `server/src/app.ts`: import `registerServerFaults`, call `registerServerFaults(app, { perMinute: env.SERVER_FAULTS_PER_MINUTE })` next to `registerMail(app)` / `registerPush(...)`, and add the decorator's type to `server/src/types/fastify.d.ts`.
- [X] T026 [US1] In `server/src/plugins/14-error-handler.ts`, after the existing log lines and after the reply is sent (both HTML and problem+json branches), when `body.type === PROBLEMS.INTERNAL.type` call `void app.recordServerFault?.({ requestId: request.id, method: request.method, route: request.routeOptions?.url ?? null, status: body.status, errorName: error.name, errorCode: error.code ?? null, message: error.message, stack: error.stack ?? null, principalKind: request.principal?.kind ?? null, principalId: request.principal?.id ?? null, clientRequestId: request.requestContext.get('clientRequestId') ?? null })`. Comment that it is not awaited (FR-004), and why the classification is `INTERNAL` and not `status >= 500` (research R1). `principal.kind` is the token audience (`member`/`admin`/`merchant`/`partner`), which is exactly the column's CHECK set. Do not rename or reorder the plugin.
- [X] T027 [P] [US1] Create `server/src/modules/server-faults/application/lookup.ts` exporting `lookupByRequestId(app, requestId)`. It selects the explicit columns from data-model §1 `WHERE request_id = $1` (unique), maps the row to `ServerFault` (camelCase, ISO dates), and returns `null` when nothing is found.
- [X] T028 [US1] Create `server/src/modules/server-faults/controller.ts` with a `createServerFaultsController(app)` that has a `lookup` handler: it throws `forbidden(PROBLEMS.NOT_FOUND, 'No fault is recorded for this request id.')` (from `server/src/authz/require-permission.ts`) when the result is `null`, otherwise it replies `{ item }`.
- [X] T029 [US1] Create `server/src/modules/server-faults/routes.ts` (a `fastify-plugin`, modelled on `server/src/modules/marketplace/staff-routes.ts`) with `GET /admin/server-faults/by-request/:requestId`:
  - `config.auth: { audience: 'staff', module: 'server_faults', flag: 'read' }`, `budget: 'admin-read'`, `rateLimit: app.bucket('admin-api')`, `onRequest: app.guard`
  - Zod params using `REQUEST_ID` from `@gwc/contracts/request-id`, and a response schema
  - a header comment saying `write`/`edit`/`delete`/`status` are deliberately unused and that the crawl posture is inherited from `/admin`

  Register it in `server/src/app.ts` after `seoStaffRoutes`.
- [X] T030 [US1] Add the job to `server/src/ops/jobs.ts`:
  - `PLATFORM_JOBS`: `{ name: 'server-faults.prune', schedule: '30 3 * * *', description: 'Delete server fault records older than 30 days' }`
  - a handler in `createJobHandlers` that first calls `app.recordServerFault.flushSuppressions?.()`, then deletes from both tables in batches of 5000 (`DELETE … WHERE ctid IN (SELECT ctid … WHERE occurred_at < now() - interval '30 days' LIMIT 5000)`) until none remain, and returns `{ itemsProcessed }`
- [X] T031 [US1] Run `npm run -w server test -- tests/server-faults tests/authz/matrix.test.ts tests/ops/logging-redaction.test.ts tests/http/error-envelope.test.ts tests/seed/table-manifest.test.ts` and make T017–T023 pass. `logging-redaction` and `error-envelope` must pass **unmodified** (FR-011).

**Checkpoint**: US1 is complete. Quickstart #1–#10 hold. It is deployable without US2 or US3 (lookup via the API or SQL).

---

## Phase 4: User Story 2: Mobile app traffic and failures in the development console (Priority: P1)

**Goal**: In development only, the Expo app logs every request (method, path, status, duration, `req=`), every failure with its problem type, and unhandled JS errors, with no secrets. Release bundles contain none of it.

**Independent Test**: `npx expo start`: sign in and open Events, and `[gwc]` lines appear. `npx expo start --no-dev --minify`: repeat, and no `[gwc]` line appears. A direct `console.log` in a screen fails `npm test -w german-world-club` (quickstart #16–#23).

**Depends on**: Phase 1 only (no database work). T032 touches the server's CORS but not the fault table.

### Tests for User Story 2 ⚠️

- [X] T032 [P] [US2] Server test in `server/tests/http/cors-request-id.test.ts`: a cross-origin `GET /health/live` with an allowed `origin` returns `access-control-expose-headers` including both `x-request-id` and `x-client-request-id`. Counter-assertion: `access-control-allow-origin` is still the allowlisted origin, never `*`.
- [X] T033 [P] [US2] Enforcement before implementation: create `expo-client/german-world-club/eslint.config.js` (flat config extending `eslint-config-expo/flat`, installed by the first `npx expo lint` run) with `rules: { 'no-console': 'error' }` and an override for `src/lib/log.ts` that turns it off. Add `"test": "expo lint"` to `expo-client/german-world-club/package.json` `scripts`, and run `npm test -w german-world-club` to confirm the baseline passes (there is no `console.*` in `src/` today). Read the SDK 57 lint docs first, as `expo-client/german-world-club/AGENTS.md` requires.

### Implementation for User Story 2

- [X] T034 [US2] Move `tokenPreview` from `server/src/modules/push/providers.ts:100` into `packages/contracts/src/push.ts` (the same implementation: first 12 chars, `…`, last 4). Re-export or import it in `providers.ts` so every server caller is unchanged, and extend `packages/contracts/src/push.test.ts` with a case for it. Run `npm run typecheck`.
- [X] T035 [US2] In `server/src/app.ts`, add `exposedHeaders: ['x-request-id', 'x-client-request-id']` to the `@fastify/cors` registration. Comment that native `fetch` sees every header but the Expo **web** build is cross-origin, and that the id is a correlation value already sent in every error body (research R9). Make T032 pass.
- [X] T036 [US2] Create `expo-client/german-world-club/src/lib/log.ts` per `specs/012-error-persistence/contracts/mobile-dev-logging.md`:
  - `devLog.request`, `devLog.failure` (4xx → `console.warn`, 5xx/network → `console.error`), `devLog.info(scope, message, fields?)` with primitive-only fields, and `devLog.error(scope, error)`
  - every body starts with `if (!__DEV__) return`
  - every line is prefixed `[gwc]`
  - `stripQuery(path)` removes everything from `?`

  Header comment: why `__DEV__` and not an `EXPO_PUBLIC_*` flag (it cannot be switched on in a release build, and the minifier removes the dead branch), and why this is the only file allowed to call `console`.
- [X] T037 [US2] Instrument `expo-client/german-world-club/src/api/client.ts`:
  - in `api()`, record `Date.now()` before `send()`
  - wrap `send()` so a thrown `fetch` calls `devLog.failure({ method, path, status: null, requestId: null, ms, problemType: null })` with the error message, then rethrows unchanged
  - after the response (and after any refresh-and-retry), read `response.headers.get('x-request-id')`, and call `devLog.request(...)` for 2xx and `devLog.failure(...)` with `problem?.type` for non-2xx, before throwing `ApiError`
  - in `refresh()`, log `POST /auth/refresh <status>` only, never the body

  Never pass headers, `body` or tokens to the logger. Keep the existing header comment accurate (the client now does four things).
- [X] T038 [US2] In `expo-client/german-world-club/src/app/_layout.tsx`, under `if (__DEV__)` at module scope, chain `ErrorUtils.setGlobalHandler`: read `ErrorUtils.getGlobalHandler()`, then set a handler that calls `devLog.error('unhandled', error)` and then the original handler with the same arguments, so LogBox and the red screen still appear. Comment why it chains rather than replaces.
- [X] T039 [US2] In `expo-client/german-world-club/src/notifications/registration.ts`, add `devLog.info('push', 'registered', { token: tokenPreview(token) })` on success and `devLog.info('push', 'skipped', { reason })` on each early return. Import `tokenPreview` from `@gwc/contracts/push`, never logging the raw token.
- [ ] T040 [US2] Run `npm run typecheck` and `npm test -w german-world-club`. Then do quickstart #16–#23 by hand in development and with `npx expo start --no-dev --minify`, including a deliberate `console.log('x')` in a screen, to confirm lint rejects it (then remove it).

**Checkpoint**: US2 is complete and independent of US1. With US1 also done, a `req=` id from a 500 finds its record (SC-004).

---

## Phase 5: User Story 3: Review recent server faults in the staff console (Priority: P2)

**Goal**: A read-only **Fehlerprotokoll** page in the staff console lists faults newest first, looks one up by request id, groups by fingerprint, and shows suppressed counts. It is visible only with `server_faults.read` (superadmins implicitly).

**Independent Test**: As a superadmin, cause one fault 3× and another once. The page lists 4 newest first, clicking a fingerprint shows the 3, and pasting a request id shows the full record. A staff user without the grant sees no sidebar entry and gets `403` from the API (quickstart #11–#15).

**Depends on**: Phase 2 and US1's T024–T029 (the table, the recorder and the routes module).

### Tests for User Story 3 ⚠️

- [X] T041 [P] [US3] `server/tests/server-faults/list.test.ts` (`skipIf(!hasDatabase)`). Insert rows directly with explicit `occurred_at`. As a superadmin, `GET /admin/server-faults` returns newest first, and the summaries have no `stack`. `limit` and `before` paginate without gaps or duplicates (`nextCursor: null` on the last page), `fingerprint=` filters, `clientRequestId=` filters (the stored client correlation id), and `suppressedLast24h` sums only the last 24 h of `server_fault_suppressions`. A bad cursor, fingerprint or limit → `400` (`validation-failed`). Counter-assertion: a 25-hour-old suppression row is not counted.
- [X] T042 [P] [US3] Add `GET /admin/server-faults` to `ROUTE_CLASSES` in `server/tests/authz/matrix.test.ts` (staff / `server_faults` / `read`), plus the non-`GET` → `404` case.
- [X] T043 [P] [US3] `client/tests/console/server-faults.test.tsx`, modelled on `client/tests/console/push.test.tsx`:
  - a sidebar entry exists only with `server_faults` in the capability snapshot
  - the list renders rows and "load older" requests `before=<nextCursor>`
  - clicking a fingerprint refetches with `fingerprint=`
  - lookup shows the full record, and on a `404` shows the translated not-found message (branching on problem `type`, not `detail`)
  - the suppression banner appears only when `suppressedLast24h > 0`
  - message and stack render verbatim in EN and DE

### Implementation for User Story 3

- [X] T044 [P] [US3] Create `server/src/modules/server-faults/application/list.ts` exporting `listServerFaults(app, { before, fingerprint, clientRequestId, limit })`:
  - keyset on `(occurred_at, id)` with the cursor as base64url of `occurredAt|id` (decode-validate it and throw the existing validation problem when malformed)
  - explicit columns, no `stack`
  - fetch `limit + 1` to compute `nextCursor`
  - `suppressedLast24h` via `SELECT coalesce(sum(suppressed), 0) FROM server_fault_suppressions WHERE minute > now() - interval '24 hours'`
- [X] T045 [US3] Add a `list` handler to `server/src/modules/server-faults/controller.ts`, and a `GET /admin/server-faults` route to `server/src/modules/server-faults/routes.ts` with the same posture as T029 and a Zod querystring (`before` optional string ≤ 200, `fingerprint` optional `^[0-9a-f]{64}$`, `clientRequestId` optional `CLIENT_REQUEST_ID`, `limit` coerced int 1–100, default 50). Make T041–T042 pass.
- [X] T046 [P] [US3] Add `serverFaultsApi = { list(params), byRequest(requestId) }` to `client/src/lib/api.ts`, next to `pushApi`, typed with `ServerFaultListResponse` / `ServerFaultLookupResponse` from `@gwc/contracts/server-faults`.
- [X] T047 [P] [US3] Add the `serverFaults.*` strings to `client/src/i18n/de.ts` and `client/src/i18n/en.ts`: page title (DE "Fehlerprotokoll", EN "Error log"), lookup label and button, not-found message, column headers, "load older", "filter by this fault", "clear filter", and the suppression banner with a count placeholder. Run `npm run -w client test:i18n`.
- [X] T048 [US3] Create `client/src/console/admin/ServerFaults.tsx`, following `client/src/console/admin/Push.tsx`'s structure:
  - lookup form, results list with "load older", fingerprint filter chip, suppression banner
  - times through the locale-aware formatter in `client/src/lib/format.ts`
  - message and stack in a `<pre>`, untranslated
  - all labels via `useTranslations()` (no hard-coded strings; `client/tests/no-hardcoded-strings.test.ts` must pass)
  - the lookup box sends a ULID (`REQUEST_ID`) to the by-request route and any other `CLIENT_REQUEST_ID`-shaped value to the list's `clientRequestId` filter; it branches on problem `type` for the 404
- [X] T049 [US3] Register the page:
  - `<Route path="fehlerprotokoll" element={<ServerFaults />} />` in `client/src/console/routes.tsx`, next to `push`
  - `{ to: '/konsole/admin/fehlerprotokoll', module: 'server_faults' }` in `ADMIN_ITEMS` in `client/src/console/admin/AdminLayout.tsx`, after `push`
  - the sidebar label in both i18n files if the sidebar reads labels by module

  Make T043 pass, and confirm `client/tests/capability-matrix.test.tsx` and `client/tests/console/unbuilt-areas.test.tsx` still pass (update the latter only if it lists built areas).

**Checkpoint**: All three stories are complete. Quickstart #11–#15 hold.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T050 [P] Update `CLAUDE.md` with a short **Server faults are recorded, not just logged (feature 012)** section:
  - `INTERNAL` only (why), recorded after reply and never awaited, the caps
  - immutable, with the 30-day delete floor in triggers
  - never seeded
  - request ids are always server-generated ULIDs; a client's `x-request-id` is only correlation (`x-client-request-id`, `clientRequestId` in logs and records), and never the id `audit_log` or `server_faults` is keyed on
  - `server_faults.read`
  - mobile: `devLog` is the only console writer, and it is removed from release bundles by `__DEV__`
- [X] T051 [P] Update `server/README.md`'s logging/operations notes: where a quoted request id leads now (console **Fehlerprotokoll**, or `SELECT … FROM server_faults WHERE request_id = …`), that job and startup failures are still log-only, and a **breaking-change note**: an integration that sent its own `x-request-id` must now read it back from `x-client-request-id`.
- [X] T052 Run the full suite `npm test` (typecheck plus every workspace, including the new `expo lint`) against a real database (`DATABASE_URL` set), and record any skipped suites in the PR description.
- [ ] T053 Walk through `specs/012-error-persistence/quickstart.md` #1–#23 end to end and note any deviation in the PR.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: depends on Phase 1 (T002 for the enum/module name, T003/T004 for types and id patterns). Blocks US1 and US3. The request-identity tasks (T013–T016) change every response's `x-request-id` behaviour, so run the full server suite after T016.
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on Phase 1 only. Can run fully in parallel with Phase 2 and US1.
- **US3 (Phase 5)**: depends on Phase 2 and US1's T024–T029 (shared `modules/server-faults/` files, and the recorder so real rows exist).
- **Polish (Phase 6)**: after the stories being shipped.

### Within-story order

- Tests first (they must fail), then application → controller → routes → wiring.
- US1: T024 → T025 → T026 (the handler needs the decorator). T027 → T028 → T029. T030 after T024 (`flushSuppressions`).
- US2: T034 before T039. T036 before T037–T039. T033 before T036 (so lint guards from the first line).
- US3: T044 → T045. T046, T047 → T048 → T049.

### Same-file hazards (never parallel)

- `server/src/app.ts`: T016, T025, T029 (registration), T035
- `server/tests/http/error-envelope.test.ts`: T013 only
- `server/src/modules/server-faults/{controller,routes}.ts`: T028/T029, then T045
- `server/tests/authz/matrix.test.ts`: T022, then T042

---

## Parallel Examples

```bash
# Phase 1, together:
T002 permissions.ts module  |  T003 contracts/server-faults.ts  |  T004 contracts/request-id.ts

# Phase 2, after T005:
T006 scrub.ts  |  T007 fingerprint.ts  |  T008 metrics.ts  |  T009 seed/tables.ts  |  T010 test helper  |  T011 unit tests

# US1 tests, together:
T017 record  |  T018 redaction  |  T019 db-down  |  T020 burst  |  T021 lookup  |  T022 matrix  |  T023 prune

# US2 alongside Phase 2/US1 (different workspace):
T032 cors test  |  T033 eslint + test script  → T034 tokenPreview → T036 log.ts → T037/T038/T039

# US3:
T041 list test  |  T042 matrix  |  T043 console test  |  T044 list.ts  |  T046 api.ts  |  T047 i18n
```

---

## Implementation Strategy

### MVP

Phase 1 → Phase 2 → **US1**. Faults are durable and findable by request id through the staff API. Stop and validate with quickstart #1–#10.

### Incremental delivery

1. MVP (US1): answers "what happened to request X?" today.
2. **US2** (it can be built in parallel from day one): mobile debugging, and the `req=` bridge to US1.
3. **US3**: the console page, so faults are noticed without a report.
4. Polish: docs, full-suite run, quickstart walk-through.

### Two-person split

- Person A: Phase 2 → US1 → US3 (server + console).
- Person B: US2 (Expo + one CORS line), right after Phase 1.

---

## Notes

- Total: 53 tasks. Setup 4, Foundational 12 (8 fault-table plus 4 request-identity), US1 15, US2 9, US3 9, Polish 4.
- Every test task carries its counter-assertion in its description. Keep them.
- Commit after each checkpoint at least. Run `npm run typecheck` whenever `packages/contracts` changes.
