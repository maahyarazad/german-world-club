---
description: "Tasks for 024: a session job that runs, and gateway errors that say what happened"
---

# Tasks: Onboarding errors that say what happened, and a session job that runs

**Input**: `specs/024-onboarding-contact-error/` (spec, plan, quickstart runbook)
**Branch**: `024-onboarding-contact-error`. No new branch, at the user's request.

**Tests**: included (CLAUDE.md: behaviour tests with counter-assertions). Server suites run
against `gwc_test` only.

## Format: `[ID] [P?] [Story] Description`

- US1: expired sessions are actually expired (P1)
- US2: a gateway error reads as "temporarily unavailable" (P1)
- US3: find why the proxy could not reach Node (P1, operations)

---

## Phase 1: Setup

- [X] T001 Confirm `git branch --show-current` is `024-onboarding-contact-error` and that the
  last migration in `server/migrations/` is `042_member_marketplace_posting.sql`, so the new one
  is `043`. Run `npm run -w server migrate` against `gwc_test`
  (`DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test`).

---

## Phase 2: User Story 1 - Expired sessions are actually expired (Priority: P1) 🎯 MVP

**Independent test**: a session with an expired, unconsumed refresh token is revoked as
`expired` by the job, which succeeds. A live one is untouched.

- [X] T002 [US1] Create `server/tests/ops/sessions-expire.test.ts` against `gwc_test`. Build the
  app with `buildAuthApp`, then:
  - create a member;
  - insert two sessions for it, each with one `refresh_tokens` row: one with
    `expires_at = now() - interval '1 day'` and `consumed_at NULL`, one with
    `expires_at = now() + interval '1 day'`. Read `007_sessions_and_refresh_tokens.sql` for the
    columns, and fill `token_hash` with random bytes;
  - run `createJobHandlers(app)['sessions.expire']()` (import from `src/ops/jobs.ts`, as
    `tests/marketplace/expiry.test.ts` does);
  - assert it resolves with `itemsProcessed: 1`, the first session has `revoked_at` set and
    `revoked_reason = 'expired'`, and the second is still unrevoked (counter-assertion);
  - add a second case: a partner session (`account_kind = 'partner'`, like the failing
    production row) is revoked the same way.

  It must fail before T003 with `sessions_revoked_reason_check`.
- [X] T003 [US1] Create `server/migrations/043_session_revoked_reason_expired.sql`:
  - `ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_revoked_reason_check`, then
    `ADD CONSTRAINT sessions_revoked_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN ('superseded','logout','staff_action','token_reuse','status_change','password_reset','expired'))`;
  - first confirm the constraint name with
    `SELECT conname FROM pg_constraint WHERE conrelid = 'sessions'::regclass AND contype = 'c'`
    on `gwc_test`. The column-level CHECK in 007 is auto-named, so use the real name;
  - wrap the drop in `SET LOCAL client_min_messages = warning`, as `040` does;
  - add a header comment: the job (`ops/jobs.ts`, `sessions.expire`) has written `expired`
    since feature 007, the constraint never allowed it, and the job failed every 15 minutes in
    production on the first expired session;
  - leave the paired CHECK `(revoked_at IS NULL) = (revoked_reason IS NULL)` untouched.

  Run migrate twice on `gwc_test`; the second run must be a no-op. Then T002 passes.
- [X] T004 [P] [US1] Add a comment above the `UPDATE` in `server/src/ops/jobs.ts`
  `'sessions.expire'`: `expired` is an allowed reason since migration 043, and a new reason must
  be added to the constraint in the same change.

**Checkpoint**: T002 passes, and the job succeeds on an expired partner session.

---

## Phase 3: User Story 2 - A gateway error reads as "temporarily unavailable" (Priority: P1)

**Independent test**: `/onboarding/register` answering 502 with an HTML body shows the translated
"Dienst nicht verfügbar" text at step 2, never "Bad Gateway".

- [X] T005 [P] [US2] Create `client/tests/lib/api-gateway.test.ts`. With `fetch` stubbed (as
  `tests/lib/upload.test.ts` stubs it), call `get('/x')`:
  - 502 with `content-type: text/html` and body `<html>Bad Gateway</html>`, statusText
    `Bad Gateway` → rejects with an `ApiError` whose `problem.type` is
    `PROBLEMS.SERVICE_UNAVAILABLE.type` and `status` is 502;
  - the same for 503 and 504;
  - counter-assertion: a 503 with `application/problem+json`
    `{ ...PROBLEMS.REQUEST_DEADLINE_EXCEEDED }` keeps that type;
  - counter-assertion: a non-problem 404 still gets `type: 'about:blank'`.
- [X] T006 [P] [US2] In `client/tests/onboarding/web-onboarding.test.tsx` (`steps 1 and 2`),
  add a test: `/onboarding/register` returns
  `{ status: 502, body: '<html>Bad Gateway</html>', headers: { 'content-type': 'text/html' } }`.
  After submitting step 2:
  - the page shows `de.problems`' service-unavailable title and body; check the exact
    describeProblem output with `describeProblem({ ...PROBLEMS.SERVICE_UNAVAILABLE, status: 502 }, 'de')`;
  - `queryByText(/Bad Gateway/)` is absent;
  - the applicant is still on step 2.
- [X] T007 [US2] In `client/src/lib/api.ts` `readProblem`:
  - when the body is not problem or JSON and `response.status` is 502, 503 or 504, return
    `{ ...PROBLEMS.SERVICE_UNAVAILABLE, status: response.status }`;
  - otherwise keep the existing `about:blank` fallback;
  - add a comment: a proxy's own error page carries no problem type, and its status text
    ("Bad Gateway") is not something an applicant can act on.

  Because `upload()` reuses `readProblem`, it is covered too. Run `npx tsc --noEmit -p client`.

**Checkpoint**: T005 and T006 pass, and the full client suite passes.

---

## Phase 4: User Story 3 - Find why the proxy could not reach Node (Priority: P1, operations)

- [ ] T008 [US3] On `dedi10021`, follow `specs/024-onboarding-contact-error/quickstart.md`, "On
  the server", steps 1–3:
  - check the process manager's status;
  - check the stderr/boot log for a refusal;
  - check the nginx error log at the time of the step-2 attempt.

  Record the cause found in `quickstart.md`. This needs a person with server access.
- [ ] T009 [US3] If T008 shows a proxy timeout, set nginx `proxy_read_timeout` above 20 s for
  the API location, because SMS routes may take up to the 20 s `otp-send` deadline. If it shows
  a boot refusal, fix the named setting or migration. Record what was changed.

---

## Phase 5: Polish

- [X] T010 Run the gates:
  - `DATABASE_URL=…/gwc_test npm run -w server test` (the 7 known failures on `main` excepted);
  - `npm run -w client test` and `npm run -w client test:i18n`;
  - `npx tsc --noEmit -p client`.
- [ ] T011 Deploy to `dedi10021` per quickstart step 4: migrate (`043`), restart, and confirm the
  next `sessions.expire` log line is `job finished`, not `job failed`. Then register through
  step 2. Needs server access.

---

## Dependencies

- T001 → US1 (T002 → T003, with T004 alongside) ∥ US2 (T005, T006 → T007).
- US3 (T008 → T009) is independent of the code.
- Polish comes last. T011 needs T003 deployed.

## Parallel examples

```text
T002 (server) ∥ T005 + T006 (client)
T004 ∥ T007
T008 can start now, on the server
```

## Implementation strategy

1. **MVP = US1.** A job failing every 15 minutes, with stale sessions never revoked, is the only
   defect actively recurring in production.
2. **US2** is the same size, ships with it, and removes "Bad Gateway" from the UI for good.
3. **US3** is the actual cause of the 502, and can only be found on the server. The code changes
   make it read better, but don't prevent it.
