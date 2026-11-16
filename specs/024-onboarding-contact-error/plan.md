# Implementation Plan: Onboarding errors that say what happened, and a session job that runs

**Branch**: `024-onboarding-contact-error` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

## Summary

- **Migration `043_session_revoked_reason_expired.sql`** widens `sessions_revoked_reason_check`
  to allow `expired`. The constraint is dropped and re-added in one transaction. Existing rows
  already satisfy the wider list, so add it `NOT VALID` and then `VALIDATE`, or add it plainly:
  the table is small.
- **A database test** for `sessions.expire`.
- **`readProblem` in `client/src/lib/api.ts`** maps a non-problem 502, 503 or 504 to
  `PROBLEMS.SERVICE_UNAVAILABLE`, which already has de and en copy. `upload()` uses the same
  function, so it is covered too.
- **A runbook for the server** in `quickstart.md`.

## Technical Context

**Language/Version**: TypeScript on Node 22 (server); React (web console)

**Storage**: PostgreSQL. One constraint changes.

**Testing**: vitest, server against `gwc_test`, client with Testing Library

**Constraints**:
- The migration must apply on the production database with live sessions.
- The client change must not alter any real problem response.

## Constitution Check

| Principle | Assessment |
|---|---|
| I. One rule set | Pass. The client only translates. |
| III. Published state = real state | Pass. "Bad Gateway" becomes the honest "temporarily unavailable". |
| IV. Integrity in the database | Pass. The constraint stays: it gains the one value the server writes. |
| V. Failure explicit and bounded | Pass. That is the fix itself: a job that failed every 15 minutes stops failing, and a gateway failure is named. |

## Project Structure

```text
server/migrations/043_session_revoked_reason_expired.sql   # new
server/tests/ops/sessions-expire.test.ts                   # new
client/src/lib/api.ts                                      # readProblem gateway mapping
client/tests/lib/api-gateway.test.ts                       # new
client/tests/onboarding/web-onboarding.test.tsx            # step 2 shows it
specs/024-onboarding-contact-error/quickstart.md           # runbook
```

## Complexity Tracking

None.
