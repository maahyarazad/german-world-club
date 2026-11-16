# Feature Specification: Onboarding errors that say what happened, and a session job that runs

**Feature Branch**: `024-onboarding-contact-error` (no new branch, at the user's request)
**Created**: 2026-11-16
**Status**: In progress
**Input**: The production server log (`gwd_node.log` on `dedi10021`), and "Bad Gateway" shown at register step 2 ("Where do you live?").

## Context

This branch already holds the onboarding fixes from 2026-11-16:

- **Step 3 edit form:** with nothing changed, saving resends the code instead of refusing.
- **Ended verification:** a dead code session shows "This verification has ended" instead of "not found".
- **Taken email:** registration says the email is registered (409) instead of disguising it.
- **SMS routes:** they get a 20 s deadline and a 10 s SMSGlobal call limit.
- **Limits:** the OTP limits are 60.

The production log adds two problems:

1. **`sessions.expire` fails every 15 minutes.** It revokes sessions whose refresh token expired
   unused with `revoked_reason = 'expired'`, but `sessions_revoked_reason_check` (migration 007)
   only allows `superseded`, `logout`, `staff_action`, `token_reuse`, `status_change` and
   `password_reset`.
   - The bug has existed since the job was written (feature 007).
   - No test covers the job.
   - It only shows once a refresh token has expired unused, which happens in production and
     rarely in development.
   - The failing row is the same every run (a partner session from 2026-10-09). No expired
     session is ever revoked, so stale sessions accumulate.
2. **"Bad Gateway" at register step 2.** A 502 comes from the reverse proxy, not from Node.
   - The log has no request lines at all in the window, only cron jobs. It ends with
     `SIGTERM … shutting down`.
   - So the request most likely arrived while Node was stopped, restarting, or failing to boot
     again (a boot gate or environment refusal goes to stderr, not this log).
   - The console then showed the proxy's bare status text, because a non-problem response falls
     back to `response.statusText`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Expired sessions are actually expired (Priority: P1)

The `sessions.expire` job revokes every session whose refresh token has expired unused, every
run, without error.

**Independent Test**: create a session with an expired, unconsumed refresh token, and run the
job. The session is revoked with reason `expired`, and the job reports 1 item. A session with a
live refresh token is untouched.

**Acceptance Scenarios**:

1. **Given** a session whose only refresh token expired unused, **When** the job runs, **Then**
   it is revoked with reason `expired`, and the job succeeds.
2. **Given** a session with a live refresh token, **When** the job runs, **Then** it is
   untouched (counter-assertion).
3. **Given** the production row that fails today, **When** the migration has run, **Then** the
   next run revokes it and succeeds.

### User Story 2 - A gateway error reads as "temporarily unavailable" (Priority: P1)

When the proxy answers 502, 503 or 504 with its own error page, the applicant sees the
translated "Service unavailable: the service is temporarily unreachable" instead of "Bad
Gateway". That holds at every step, and everywhere else in the console.

**Independent Test**: make `/onboarding/register` answer 502 with an HTML body. Step 2 shows the
translated service-unavailable text, not "Bad Gateway".

**Acceptance Scenarios**:

1. **Given** a 502, 503 or 504 whose body is not problem JSON, **When** any console request
   receives it, **Then** it is read as the `service-unavailable` problem (status kept), and
   shown translated.
2. **Given** a real problem response with status 503, **When** it is received, **Then** its own
   type is kept (counter-assertion).
3. **Given** a non-problem 404 or 400, **When** it is received, **Then** the existing fallback is
   unchanged.

### User Story 3 - Find why the proxy could not reach Node (Priority: P1, operations)

Whoever runs the server can tell, from the server itself, whether Node was down, restarting, or
refusing to boot when the 502 happened, and fix that.

**Independent Test**: following the runbook in `quickstart.md` on `dedi10021` names the cause.

### Edge Cases

- **A long SMSGlobal send** is no longer a 502 cause: the proxy's default read timeout (60 s) is
  well above the 20 s SMS deadline. If the proxy's timeout is shorter, it must exceed 20 s.
- **Migrations:** deploying this branch without running migrations leaves User Story 1
  unfixed. The runbook says to migrate.

## Requirements *(mandatory)*

- **FR-001**: `revoked_reason` MUST accept `expired`, by a new migration, without rewriting
  existing rows.
- **FR-002**: `sessions.expire` MUST have a test that revokes an expired session and leaves a
  live one, run against a database.
- **FR-003**: The console MUST read a non-problem 502, 503 or 504 as `service-unavailable`,
  keeping the status, and show its translated copy.
- **FR-004**: Other non-problem responses keep the existing fallback.
- **FR-005**: A runbook MUST say how to check the process, the boot errors and the proxy log on
  the server, and how to deploy (migrate, restart, verify).

## Success Criteria *(mandatory)*

- **SC-001**: 0 `sessions.expire` failures after deploying and migrating.
- **SC-002**: No screen shows "Bad Gateway". A gateway failure always reads as "temporarily
  unavailable" in the console's language.
- **SC-003**: The next 502, if any, can be attributed to a cause from the server's logs in
  minutes.

## Assumptions

- The log path `/usr/home/admin/staging.german-world-club.com` is the deployment the user calls
  production.
- Nothing here changes what the server answers for its own refusals.
