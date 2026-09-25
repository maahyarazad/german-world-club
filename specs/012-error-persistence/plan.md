# Implementation Plan: Persisted Server Errors and Mobile Development Logging

**Branch**: `012-error-persistence` | **Date**: 2026-09-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-error-persistence/spec.md`

## Summary

Two independent halves, resting on one change to request identity.

**Request identity** (research R10). `genReqId` stops adopting a client-supplied `x-request-id`: every request id is a server-generated ULID, so ids in logs, `audit_log`, error bodies and fault records are unique and time-sortable, and no client can choose them. A well-formed client value is kept as a separate correlation id. It is echoed on `x-client-request-id`, bound into every log line of the request through `childLoggerFactory`, and stored on a fault record. Both id patterns move into `@gwc/contracts`, which removes the duplicated `SAFE_ID` (analysis C1).

**Server.** Every request whose error the central handler classifies as `INTERNAL` is recorded in a new `server_faults` table:
- **What is stored**: an allowlisted, scrubbed record (request id, route pattern, status, error name/code, message, stack, principal kind/id, fingerprint).
- **How it is written**: by a decorator the error handler calls *after* replying and without awaiting, so the response is unchanged even when the database is the cause.
- **Bounds**: a per-minute cap, an in-flight cap and a statement timeout. Suppressed occurrences are counted per minute.
- **Integrity**: records are immutable and deletable only after 30 days, both enforced by trigger. A daily, individually switchable job prunes them.
- **Reading them**: superadmins, and anyone granted the new `server_faults.read` module, read them through two read-only staff routes and a new console page, **Fehlerprotokoll**.

**Mobile.** A single `devLog` module is wrapped in `__DEV__`, so it is removed from release bundles.
- **What it logs**: every API request (method, path, status, duration, `x-request-id`), every failure with its problem type, and unhandled JS errors.
- **Redaction by construction**: headers and bodies never reach the logger.
- **Enforcement**: ESLint `no-console` makes it the only way to write to the console.

The `req=` id a developer sees on a failing request is the key the console page looks up.

## Technical Context

**Language/Version**: TypeScript on Node 22 (server: ES modules, type-stripped `.ts`), React 19 (console), Expo SDK 57 / React Native (mobile)

**Primary Dependencies**:
- Fastify 5, `pg`, `@fastify/cors`, `croner` (jobs), Zod (route schemas) on the server
- React Router in the console
- `expo-router` in the app
- No new dependencies. `eslint-config-expo` is installed by `expo lint` on first run.

**Storage**: PostgreSQL. Migration `030_server_faults.sql`: `server_faults`, `server_fault_suppressions`, plus a new `admin_module` enum value.

**Testing**: Vitest for server and client (SQL suites skip loudly without a database), `test:i18n` parity, and `expo lint` for the mobile guard. Manual release-bundle check with `npx expo start --no-dev --minify`.

**Target Platform**: Linux server; staff console in evergreen browsers; iOS/Android (and the Expo web build) for development logging.

**Project Type**: Web service + web client + mobile app (npm workspaces, shared `@gwc/contracts`).

**Performance Goals**: Recording adds no latency to the error response (not awaited). At most 2 recorder connections out of the pool's 10.

**Constraints**:
- ≤ `SERVER_FAULTS_PER_MINUTE` (default 60) stored records per instance per minute
- recorder insert `statement_timeout` 1 000 ms
- message ≤ 2 000 chars, stack ≤ 8 000
- zero `[gwc]` console output in release bundles

**Scale/Scope**: Expected dozens of faults per day, and thousands per minute at worst during an outage (capped). 2 staff routes, 1 console page, 1 job, 1 migration, 1 mobile module plus 2 integration points.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Touched by | Status | Automated check |
|---|---|---|---|
| **I. One rule set, three clients** | `ServerFault` types, the `server_faults` module constant, `tokenPreview`, the request-id patterns | ✅ `REQUEST_ID` and `CLIENT_REQUEST_ID` are defined once in `packages/contracts/src/request-id.ts` and imported by the server, replacing `SAFE_ID` (C1). Types in `packages/contracts/src/server-faults.ts`; module appended to `MODULES`, so the permission editor and sidebar derive from it. `tokenPreview` moves from the server into `@gwc/contracts/push`, so the app's masking cannot drift from the server's. The mobile logger computes no business rule. | `tsc --noEmit` across all workspaces; `client/tests/capability-matrix.test.tsx` picks up the new module |
| **II. Declare every posture** | 2 new staff routes, 1 console page | ✅ Each route declares `config.auth` (staff / `server_faults` / `read`). `/admin` is already gated and never indexed, so it inherits its crawl posture. The boot gate refuses an undeclared route. | Boot gate + access-control matrix test extended with both routes × every principal kind, and non-`GET` methods → 404 |
| **III. Published state matches real state** | Lookup by unknown request id | ✅ A real `404 not-found`, identical to any absent resource | New test in `tests/server-faults/lookup.test.ts` |
| **IV. Integrity in the database** | Immutability, retention, suppression counter, request-id uniqueness | ✅ `request_id` is `UNIQUE` with a ULID CHECK, possible only because ids are server-generated (R10); `BEFORE UPDATE` trigger refuses edits; `BEFORE DELETE` trigger enforces the 30-day floor; suppression upsert keyed on `(minute, instance_id)`, so a retried flush cannot double-count | `tests/server-faults/immutability.test.ts` (raw SQL, with a counter-assertion that an expired row *can* be deleted) |
| **V. Failure explicit and bounded** | Recorder vs a failing database | ✅ Not awaited; in-flight cap 2; per-minute cap; per-insert timeout; failures counted, and the original log line is always written. No change to route budgets: the recorder is not an inline dependency of any route class. | `tests/server-faults/db-down.test.ts` (response identical and within bound), `burst.test.ts` |
| **VI. Server shapes what leaves it** | Records, console responses, mobile logs | ✅ Allowlisted record shape; free-text scrub; route pattern not URL; no bodies, headers or queries. Staff responses name every column explicitly (no `SELECT *`). Mobile logs never see headers or bodies. | `tests/server-faults/redaction.test.ts` sends every sensitive field into a failing request and scans the row; an explicit-columns test for the module's queries; `expo lint` `no-console` |
| **Workflow: scheduled work auditable** | `server-faults.prune` | ✅ In `PLATFORM_JOBS`, individually enableable, runs recorded like every job | New `tests/server-faults/prune.test.ts`: the job is registered, deletes only expired rows, and does nothing while disabled |
| **Request identity** (IV: audit records a client cannot forge the key of) | `genReqId`, `childLoggerFactory`, `x-client-request-id` | ✅ A client can no longer choose the id `audit_log` and the logs are keyed on | Rewritten `tests/http/error-envelope.test.ts` cases, plus new `tests/http/request-id.test.ts` (SC-007: log lines including "request completed", audit row, echo header) |
| **Workflow: log scan** | Unchanged log line | ✅ `tests/ops/logging-redaction.test.ts` still passes unmodified | Existing |
| **Seed rules** | Two new tables | ✅ Never seeded; added to `seed/tables.ts` as `never` | `tests/seed/table-manifest.test.ts` |

**Gate result (pre-research)**: PASS. No violations, so Complexity Tracking stays empty.

**Re-check (post-design)**: PASS. Request ids are now always server-generated (R10), which strengthens `audit_log`'s integrity and makes `server_faults.request_id` unique. The one behavioural break (a client's own id no longer comes back as `x-request-id`) is listed for the PR. The design also added `exposedHeaders: ['x-request-id', 'x-client-request-id']` to CORS (R9). That only reveals a correlation id the server already sends to every client in the header and in every error body. It carries no credential and no PII, and CORS `origin`/`credentials` are unchanged. It does not affect Principle II or VI.

## Project Structure

### Documentation (this feature)

```text
specs/012-error-persistence/
├── plan.md                        # This file
├── spec.md
├── research.md                    # R1–R9
├── data-model.md                  # server_faults, server_fault_suppressions, module
├── quickstart.md                  # 23 validation scenarios
├── contracts/
│   ├── server-faults-api.md       # staff routes + console page
│   └── mobile-dev-logging.md      # devLog API, line format, enforcement
├── checklists/requirements.md
└── tasks.md                       # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
packages/contracts/src/
├── request-id.ts                  # NEW: REQUEST_ID (ULID), CLIENT_REQUEST_ID (replaces server SAFE_ID)
├── permissions.ts                 # + 'server_faults' in MODULES
├── push.ts                        # + tokenPreview, moved from server/src/modules/push/providers.ts
└── server-faults.ts               # NEW: ServerFault, ServerFaultSummary, list/lookup response types

server/
├── migrations/030_server_faults.sql          # NEW: tables, indexes, triggers, enum value
├── src/
│   ├── config/env.ts                         # + SERVER_FAULTS_PER_MINUTE
│   ├── decorators/server-faults.ts           # NEW: app.recordServerFault (caps, flush, metrics)
│   ├── ops/scrub.ts                          # NEW: pure free-text scrubber
│   ├── ops/metrics.ts                        # + serverFaults counters
│   ├── ops/jobs.ts                           # + server-faults.prune
│   ├── plugins/00-request-context.ts         # server-only ids; readClientRequestId; childLoggerFactory; echo header
│   ├── plugins/14-error-handler.ts           # call recorder when problem is INTERNAL
│   ├── app.ts                                # genReqId/childLoggerFactory; decorator + routes; CORS exposedHeaders
│   ├── seed/tables.ts                        # both tables: never seeded
│   └── modules/server-faults/                # NEW
│       ├── routes.ts
│       ├── controller.ts
│       └── application/{list.ts, lookup.ts, fingerprint.ts}
└── tests/server-faults/                      # NEW: record, redaction, db-down, burst,
                                              #      immutability, lookup, access matrix, prune

client/src/
├── console/admin/ServerFaults.tsx            # NEW: Fehlerprotokoll page
├── console/admin/AdminLayout.tsx             # + sidebar entry
├── console/routes.tsx                        # + route
├── lib/api.ts                                # + two calls
└── i18n/{de,en}.ts                           # + strings
client/tests/console/server-faults.test.tsx   # NEW

expo-client/german-world-club/
├── eslint.config.js                          # NEW: no-console except src/lib/log.ts
├── package.json                              # + "test": "expo lint"
└── src/
    ├── lib/log.ts                            # NEW: devLog, __DEV__-guarded
    ├── api/client.ts                         # timing, x-request-id, request/failure lines
    ├── app/_layout.tsx                       # dev-only global error handler chain
    └── notifications/registration.ts         # devLog.info on register/skip, token via shared tokenPreview
```

**Structure Decision**: The existing workspace layout. Server code follows `server/ARCHITECTURE.md`:
- the HTTP-facing staff reads go in a new `modules/server-faults/`, split into routes/controller/application
- the cross-cutting recorder is a decorator
- the scrubber is framework-free `ops/` code
- the migration continues the numbered sequence

The error handler keeps its place in the plugin order. It reads the decorator lazily at error time, so no plugin is renumbered.

## Complexity Tracking

No constitution violations to justify.
