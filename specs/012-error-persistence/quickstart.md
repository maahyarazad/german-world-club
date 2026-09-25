# Quickstart: Persisted Server Errors and Mobile Development Logging

**Feature**: 012-error-persistence

Validation scenarios that prove the feature end to end. Shapes are in [data-model.md](./data-model.md) and [contracts/](./contracts/). This guide says how to check them, not how to build them.

## Prerequisites

```bash
npm install
npm run -w server migrate          # applies 030_server_faults.sql
npm run -w server seed:dev         # includes a superadmin (@test.invalid)
npm run -w server dev
```

A reproducible fault is needed. The test suites register a probe route that throws. For manual checks in development, stop Postgres after the server is up and call any database-backed member route. That produces `INTERNAL` on some paths and a deliberate `503` on others, which exercises both sides of R1.

---

## Server

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Fault is recorded | Trigger an unexpected fault; note `requestId` from the problem body | `SELECT … FROM server_faults WHERE request_id = '<id>'` returns one row with the route **pattern**, status, error name, scrubbed message and stack |
| 2 | Survives restart | Restart the server, repeat the query | Row still there (SC-001) |
| 3 | Refusals are not recorded | Cause a 404, 400 (validation), 403 and 429 | No new rows (FR-005) |
| 4 | Deliberate 503s are not recorded | Trip a breaker / exceed a deadline in the resilience suite | No new rows; `app.metrics` counters move as before |
| 5 | No secrets | `npm run -w server test -- tests/server-faults/redaction` | Every sensitive field sent into a failing request is absent from the row (SC-002) |
| 6 | Response unchanged when the DB is down | `tests/server-faults/db-down` | Status, body and latency bound equal the no-recording baseline; `serverFaults.failed` increments; log line still written (SC-003, FR-004) |
| 7 | Burst cap | `tests/server-faults/burst` with `SERVER_FAULTS_PER_MINUTE=5`, 20 faults | 5 rows stored; one `server_fault_suppressions` row with `suppressed = 15` after the minute rolls |
| 8 | Immutable | `UPDATE server_faults SET message = 'x'` in psql | Refused by trigger |
| 9 | Retention floor | `DELETE FROM server_faults` in psql | Only rows older than 30 days removed; younger rows refused |
| 10 | Prune job | Run `server-faults.prune` from the jobs page with a row back-dated 31 days in the test DB | Row gone; job run recorded; disabling the job stops it (SC-006) |
| 10a | Ids are server-generated | `curl -si -H 'x-request-id: support-ticket-42' localhost:3000/health/live` | `x-request-id` is a 26-char ULID, not `support-ticket-42`; `x-client-request-id: support-ticket-42` is echoed; the server's log lines for it show both `requestId` (ULID) and `clientRequestId` (SC-007) |
| 10b | Malformed client id dropped | Repeat with `x-request-id: 'no spaces allowed!'` | No `x-client-request-id` header and no `clientRequestId` in the log |
| 10c | Correlation on a fault | Trigger #1 while sending `x-request-id: support-ticket-43` | The row's `request_id` is the ULID from the response; `client_request_id = 'support-ticket-43'`; the console list filtered by `clientRequestId=support-ticket-43` finds it |

## Console

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 11 | Lookup | Sign in as the superadmin → **Fehlerprotokoll** → paste the id from #1 | Full record shown (Story 1 via UI) |
| 12 | Unknown id | Paste a well-formed id that never failed | Translated "no fault recorded for this id"; the response is the ordinary `404` |
| 13 | List + fingerprint | Cause the same fault 3× and another once | Newest first; clicking a fingerprint shows the 3 (Story 3) |
| 14 | Gate | Sign in as a staff user without `server_faults.read` | No sidebar entry; direct API call → `403` |
| 15 | Language | Switch to EN | Labels translate; message/stack unchanged; `npm run -w client test:i18n` passes |

## Mobile (Expo)

```bash
cd expo-client/german-world-club
npx expo start                     # development
```

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 16 | Request lines | Sign in, open Events | One `[gwc] METHOD /path STATUS NNms req=…` line per request in the Metro terminal |
| 17 | Failure lines | Stop the server, pull to refresh | `[gwc] … network-error …` at error level |
| 18 | Server fault → record | Trigger a fault from the app | `[gwc] … 500 … req=<id> type=…/internal`; that id finds the record in #11 within a minute (SC-004) |
| 19 | No secrets | Sign in, verify an OTP, register push | No token, password, code, body or full push token in the output |
| 20 | Unhandled error | Throw from a button in a dev-only screen | `[gwc] unhandled …` then the usual red screen |
| 21 | Release is silent | `npx expo start --no-dev --minify`, repeat #16–#19 | No `[gwc]` lines at all (SC-005) |
| 22 | Direct console refused | Add `console.log('x')` to any screen, run `npm test -w german-world-club` | Lint fails with `no-console` (FR-016) |
| 23 | Web build sees request ids | `npx expo start --web`, repeat #16 | `req=` is present on successful requests (R9: `exposedHeaders`) |
