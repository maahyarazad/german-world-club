# Research: Persisted Server Errors and Mobile Development Logging

**Feature**: 012-error-persistence | **Date**: 2026-09-24

Each entry records a decision, why it was taken, and what was rejected. Paths are repo-relative.

---

## R1. What counts as a "server fault"

**Decision**: Record a request if, and only if, the problem the error handler builds for it is `PROBLEMS.INTERNAL` (`buildProblem(error, request).type === PROBLEMS.INTERNAL.type` in `server/src/plugins/14-error-handler.ts`).

**Rationale**: `problemFor()` already separates deliberate answers from faults. Each deliberate 5xx has its own problem type:
- load shedding → `SERVICE_UNAVAILABLE`, sent directly by `08-under-pressure.ts`, never reaching the handler
- open breaker → `problem.status ?? 503` (`13-breakers.ts:57`)
- deadline → `REQUEST_DEADLINE_EXCEEDED`
- SMS or payments down → a declared `SERVICE_UNAVAILABLE`

Only an error the platform did not anticipate falls through to `INTERNAL`. So the rule reuses the classification the client already sees, and a record exists exactly when the member was shown "An internal error occurred."

**Alternatives rejected**:
- *Every status ≥ 500*: this stores every deliberate 503 during an outage, which is when the store can least afford the writes and when they tell you least. The metrics counters already count these (FR-005).
- *Status === 500*: an unanticipated error carrying `statusCode: 502` (e.g. from an HTTP helper) maps to `INTERNAL` but would be missed.

---

## R2. Where recording happens, and why it cannot affect the response

**Decision**: A new decorator `app.recordServerFault(fault)` in `server/src/decorators/server-faults.ts` (the convention for cross-cutting `app.decorate` calls). The error handler calls it **after** `reply.send`, without awaiting, as `void app.recordServerFault?.(…)`. The recorder catches everything itself. The existing `request.log.error({ err, requestId }, 'request failed')` line stays exactly as it is and runs first (FR-011).

The decorator is read at error time, not at registration. So `14-error-handler` keeps its place in the numbered order (it registers before `05-db`) and no plugin is renumbered. If the decorator or `app.pg` is absent (unit tests that build a bare app), recording is skipped.

**Rationale**:
- FR-004: the response must not wait on the store. Not awaiting keeps the reply's timing unchanged, and a recorder that swallows its own failures cannot become a second error.
- A decorator rather than inline code: the recorder is testable on its own (burst cap, truncation, redaction) without driving HTTP.

**Alternatives rejected**:
- *An `onResponse` hook reading a flag the handler set*: two places to keep in step for no gain.
- *Awaiting the insert before replying*: couples the error response's latency to the database. Worst of all when the database is the cause.

---

## R3. Bounding the recorder (burst cap, pool protection, timeouts)

**Decision**, all per server instance:
- **Burst cap**: at most `SERVER_FAULTS_PER_MINUTE` records stored per wall-clock minute (default `60`). Beyond it, occurrences are counted in memory.
- **In-flight cap**: at most **2** recorder inserts in flight. An occurrence arriving while two are pending is counted as suppressed, not queued.
- **Suppression row**: when a minute with suppressed occurrences ends, the next recorder call (or the prune job's tick, whichever comes first) writes one row to `server_fault_suppressions (minute, instance_id, suppressed)`. Every write is one row per instance per minute, at most.
- **Statement timeout**: each insert runs as `SET LOCAL statement_timeout = 1000` inside its own short transaction, below the pool-wide `statement_timeout` in `server/src/db/pool.ts`.
- A metrics counter `serverFaults` (`stored`, `suppressed`, `failed`) is added to `server/src/ops/metrics.ts`, so the numbers are visible without the database.

**Rationale**:
- The pool is `max: 10` (`db/pool.ts:16`). If every failing request took a connection to record itself, a fault storm would starve the requests that still work. That is Principle V: *a protective mechanism must not become the outage*. Two in flight never takes more than a fifth of the pool.
- When the database itself is down, inserts wait up to `connectionTimeoutMillis` (5 s). The in-flight cap turns everything behind them into a cheap in-memory increment.
- A suppression count per minute satisfies FR-006 ("the count is visible") at a fixed write cost.

**Alternatives rejected**:
- *Group by fingerprint and upsert a counter*: needs a row lock on every repeat, which is exactly the hot-row contention to avoid during a storm, and it loses per-occurrence request ids, which is Story 1's whole point.
- *Queue through the outbox / pg-boss*: that also writes to Postgres, so it adds a hop without removing the dependency.
- *A Redis buffer*: Redis is disabled by default (`REDIS_ENABLED=false`), and the flush would bring the same Postgres write back.

---

## R4. Keeping PII and secrets out of records

**Decision**: The recorder receives a **fixed, allowlisted shape** built in the error handler. It never receives `request` or the error object itself:

| Field | Source | Treatment |
|---|---|---|
| `requestId` | `request.id` | Always server-generated ULID (R10) |
| `clientRequestId` | request context | The client's correlation id if well-formed, else `null` (R10) |
| `method` | `request.method` | As is |
| `route` | `request.routeOptions?.url` | The **pattern** (`/member/events/:id`), never `request.url`, so no path values and no query string. `null` when no route matched. |
| `status` | the built problem's status | As is |
| `errorName`, `errorCode` | `error.name`, `error.code` | ≤ 100 chars |
| `message` | `error.message` | Scrubbed (below), ≤ 2 000 chars |
| `stack` | `error.stack` | Scrubbed, ≤ 8 000 chars |
| `principalKind`, `principalId` | `request.principal?.kind/id` | Internal ids only, never a name or email address |

**Scrubbing** (`server/src/ops/scrub.ts`, a pure function): replace email addresses, phone-number-like digit runs (≥ 7 digits with optional `+`, spaces or dashes), JWT-shaped strings (`xxx.yyy.zzz` base64url) and long hex/base64 runs (≥ 32 chars) with `[redacted]`.

Driver-specific fields that carry values are **never** copied. Postgres's `error.detail` (`Key (email)=(a@b.c) already exists`) is the example.

**Rationale**: Principle VI says credentials, tokens, codes and contact details must not appear in logs or error bodies, and redaction must be central so it covers code not yet written. The pino `REDACT_PATHS` protect *keys*. They cannot see inside a free-text `message`, and an error message is exactly where a value tends to end up. Allowlisting the shape removes bodies, headers and cookies structurally. Scrubbing covers the one free-text field that has to remain.

**Alternatives rejected**:
- *Store the pino-serialised `err`*: it includes enumerable properties such as `detail` and `query`.
- *Don't store messages at all*: then "what failed" (Story 1) mostly disappears.

---

## R5. Fingerprint

**Decision**: `fingerprint = sha256(errorName | errorCode | method | route | firstAppFrame)`, stored as hex, where `firstAppFrame` is the first stack line under `server/src/`, with line and column numbers stripped (`at createPost (modules/threads/application/compose.ts)`).

**Rationale**: Grouping must survive an unrelated edit that shifts line numbers. The route and the first application frame separate "the same bug" from "the same exception type thrown somewhere else". Computed in Node, so the scrub step sees the stack first.

**Alternatives rejected**:
- *Hash the whole stack*: every deploy changes it.
- *Hash the message*: messages embed ids, and the scrub makes them lossy.

---

## R6. Storage, immutability, retention

**Decision**:
- Migration `030_server_faults.sql` adds `server_faults` and `server_fault_suppressions` (see `data-model.md`).
- A `BEFORE UPDATE` trigger refuses every update. A `BEFORE DELETE` trigger refuses to delete a row younger than 30 days. So even an ad-hoc `DELETE FROM server_faults` in psql removes only expired rows (Principle IV: the invariant lives in the database).
- The job `server-faults.prune` (`30 3 * * *`) is added to `PLATFORM_JOBS` in `server/src/ops/jobs.ts`. It deletes rows past 30 days in batches of 5 000 and flushes any pending suppression count. It can be switched off like every job, and records its runs in the existing job-run table.

**Rationale**: The spec says records are never edited and only retention removes them (FR-007, FR-010). A trigger makes that a property of the table rather than a convention. The 30-day floor in the trigger also keeps a mistyped retention constant from deleting fresh evidence.

**Alternatives rejected**:
- *Partitioning by day with partition drops*: fine at scale, but the expected volume (dozens per day) doesn't justify the operational weight.
- *Reuse `audit_log`*: it records security and business events and nobody may edit it. Filling it with stack traces would dilute the one table that must stay readable.

---

## R7. Access: new permission module and the console page

**Decision**:
- A new module **`server_faults`**:
  - appended to `MODULES` in `packages/contracts/src/permissions.ts`
  - `ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'server_faults'` in migration `030`
  - only the `read` flag is used. `write`, `edit`, `delete` and `status` are deliberately unused, as `marketplace_moderation` does for `write`/`edit`.
  - Superadmins pass automatically (`authz/permissions.ts:99`). Nobody else is granted it by the migration, which satisfies "granted by default only to superadmins".
- Staff routes live in `server/src/modules/server-faults/` (`routes.ts`, `controller.ts`, `application/`):
  - `GET /admin/server-faults`: newest first, keyset pagination, optional `fingerprint` filter
  - `GET /admin/server-faults/by-request/:requestId`: exact lookup
  - both use `config.auth: { audience: 'staff', module: 'server_faults', flag: 'read' }`, `budget: 'admin-read'`, `rateLimit: app.bucket('admin-api')`, `onRequest: app.guard`
  - `/admin` is already gated and never indexed in `seo/surfaces.ts`, so crawl posture is inherited
- Response and query types live in `packages/contracts/src/server-faults.ts`, imported by server and console. The console page is `/konsole/admin/fehlerprotokoll` (`client/src/console/admin/ServerFaults.tsx`), with a sidebar entry `{ to: '/konsole/admin/fehlerprotokoll', module: 'server_faults' }` in `AdminLayout.tsx` and strings in `client/src/i18n/{de,en}.ts`.

**Rationale**:
- A dedicated module rather than reusing `settings` or `jobs`: stack traces reveal internals, and granting "settings" should not quietly grant them.
- The sidebar already renders from module names, so the permission editor picks the new module up from `MODULES` with no second list (Principle I).

**Alternatives rejected**: gating on `is_superadmin` in code. The matrix is the one authorization mechanism, and a special case in code is the kind of second rule the constitution forbids.

---

## R8. Mobile: development-only logger

**Decision**:
- A single module `expo-client/german-world-club/src/lib/log.ts` exporting `devLog` with `request`, `failure`, `info` and `error`. Every function body is wrapped in `if (__DEV__)`.
  - React Native defines `__DEV__` as a constant, `false` in release bundles, and the Metro minifier removes dead code under a constant-false branch. So in preview/production builds the logging is **absent from the bundle**, not switched off (FR-015).
  - There is deliberately no runtime flag (no `EXPO_PUBLIC_*` switch) that could turn it on in a release build.
- **The API client** (`src/api/client.ts`) is the one integration point:
  - It times each `send()`.
  - It reads `x-request-id` from the response.
  - It calls `devLog.request({ method, path, status, ms, requestId })`, and on failure `devLog.failure({ …, problemType })`.
  - A thrown `fetch` (offline) is logged as a network failure, with no status.
  - The refresh path logs `POST /auth/refresh <status>` and never the body.
- **Unhandled errors**: in `src/app/_layout.tsx`, under `__DEV__`, wrap `ErrorUtils.getGlobalHandler()` so an unhandled JS error is logged through `devLog.error` and then passed on to the original handler. LogBox and the red screen keep working.
- **Redaction by construction**:
  - the logger never receives headers or bodies
  - `path` has its query string stripped
  - the push module logs `tokenPreview(token)`, never the token. The helper moves from `server/src/modules/push/providers.ts` into `@gwc/contracts/push`, and the server re-imports it. The app then masks exactly as the server does, instead of keeping a second copy of the rule.
- **Enforcement** (FR-016): an ESLint `no-console: 'error'` rule in the Expo app's `eslint.config.js`, with an override allowing it only in `src/lib/log.ts`. The app gains `"test": "expo lint"`, so the root `npm test` (every workspace) fails on a stray `console.*`.
- **Where it appears**: the terminal running `npx expo start`, and React Native DevTools. No extra tooling (spec edge case).

**Rationale**: `__DEV__` is the only switch that cannot be turned on in a shipped build. Instrumenting the one API client covers every screen at once, since screens never call `fetch` (client.ts header comment).

**Alternatives rejected**:
- *`babel-plugin-transform-remove-console` in production*: it strips calls but leaves any argument-building code, and it hides a stray `console.log` instead of refusing it.
- *A logging library (e.g. `react-native-logs`)*: a dependency for four functions.
- *Sending mobile logs to the server*: out of scope per the spec.

**Verification note**: `AGENTS.md` requires checking the SDK 57 docs before writing code. The Expo debugging guide confirms `npx expo start --no-dev --minify` runs the app as a production bundle locally ("--minify is used to minify your code the same way it is for production JavaScript bundles"). That is how SC-005 is checked without an EAS build.

---

## R9. The request id reaching the mobile app

**Decision**: Add `exposedHeaders: ['x-request-id', 'x-client-request-id']` to the `@fastify/cors` registration in `server/src/app.ts`.

**Rationale**: Native iOS/Android `fetch` sees every header. The **web** build of the Expo app (`src/session/storage.web.ts` exists, so it ships one) is cross-origin, and a browser hides non-safelisted headers unless they are exposed. Without this, development logs on web would show no request id on successful requests. Error responses already carry `requestId` in the problem body, so failures were never affected.

**Alternatives rejected**: reading the id only from problem bodies. Successful requests would then lose it, and SC-004's "failing screen → server record" path starts from whichever line the developer is looking at.

---

## R10. Request ids are always server-generated; a client's id is correlation only

**Decision**:
- **`genReqId` ignores every inbound header** and always returns a ULID from `monotonicFactory()` (the `ulid` package is already a dependency). `request.id`, the `x-request-id` response header, the problem body's `requestId`, `audit_log.request_id` and `server_faults.request_id` are therefore always server-generated, unique, and strictly ordered within a process.
- **A client-supplied `x-request-id` is read once**, by `readClientRequestId(raw)` in `server/src/plugins/00-request-context.ts`, and validated against `CLIENT_REQUEST_ID` (`^[A-Za-z0-9_-]{8,64}$`, the former `SAFE_ID`). When it is well-formed:
  - it is stored as `clientRequestId` in the request context
  - it is echoed on a **distinct** response header, `x-client-request-id`
  - it is bound into the request's logger (below)
  - it is stored on a fault record's `client_request_id`

  A malformed value is dropped entirely: no echo, no log field, no storage.
- **Logging**: the value is bound through Fastify's `childLoggerFactory` server option (a factory in `00-request-context.ts`, passed in `app.ts` next to `genReqId`). It adds `{ clientRequestId }` to the bindings when the raw request carries a valid one. Every line of that request then shows it next to `requestId`, including Fastify's own "incoming request" and "request completed" lines, which reassigning `request.log` in a hook would miss because `reply.log` is captured when the request is created.
- **Both patterns live in `@gwc/contracts`** (`packages/contracts/src/request-id.ts`): `REQUEST_ID` (ULID: `^[0-9A-HJKMNP-TV-Z]{26}$`) and `CLIENT_REQUEST_ID`. The server imports them and `SAFE_ID` is deleted. This resolves analysis finding C1: each rule has one definition, and the migration's CHECKs restate them as database constraints, which Principle IV encourages.

**Rationale**:
- A client choosing the id breaks the properties the id exists for. ULIDs were chosen so a time-window log scan is cheap (the `00-request-context.ts` header comment), and `audit_log` joins on the id. A client can repeat an id, pick one that sorts anywhere, or deliberately collide with another request's id to muddy an audit trail.
- Keeping the client's value as a separate, clearly named field keeps the support benefit: a proxy's or app's own id finds the request in the logs and in `server_faults` without giving up uniqueness or ordering.
- Uniqueness lets `server_faults.request_id` be `UNIQUE`, so a lookup returns exactly one record.

**Consequences**:
- `server/tests/http/error-envelope.test.ts` ("reuses a validly-shaped client-supplied request id") asserts the old behaviour and is rewritten to assert the new one.
- Header-set comparisons in `tests/auth/non-enumeration.test.ts`, `tests/marketplace/ownership.test.ts` and `tests/offers/visibility.test.ts` send no client id, so `x-client-request-id` never appears in them and they are unaffected.
- Any external system that relied on its own id coming back as `x-request-id` must now read `x-client-request-id`. That is noted as a breaking change in the PR.

**Alternatives rejected**:
- *Keep adopting well-formed client ids*: that trades uniqueness and ordering for a convenience the separate field provides anyway.
- *Accept only `x-client-request-id` inbound*: proxies and clients conventionally send `x-request-id`. Reading that header but never adopting it keeps those correlations without a coordination change.
- *Rebind `request.log` in an `onRequest` hook*: misses the automatic request and response lines (above).
