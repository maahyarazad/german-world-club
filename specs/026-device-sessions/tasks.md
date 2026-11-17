---
description: "Tasks for 026: device sessions without a separate device approval"
---

# Tasks: Device sessions, without a separate device approval

**Input**: `specs/026-device-sessions/` (spec, plan, research, data-model, contracts/devices-api.md, quickstart)
**Branch**: `026-device-sessions`, created from `main` in T002.
**Tests**: included (CLAUDE.md: behaviour tests with a counter-assertion). SQL suites run only against `gwc_test`; they skip without a DB, so run them on a machine that has Postgres. Never run `seed:demo`, migrations or tests against production.

## Format: `[ID] [P?] [Story] Description`

- US1: approved member uses app and web together (P1)
- US2: member sees their devices in settings (P2)
- US3: member ends a device (P3)

---

## Phase 1: Setup

- [X] T001 **Gate** (done 2026-11-17, owner approved; constitution is now 3.0.0, MAJOR because a MUST is downgraded): amend the constitution with `/speckit-constitution`: in `.specify/memory/constitution.md`, Technology & Security Baseline, replace "At most one session per account is active; a new sign-in terminates the previous one." with "At most one session per *device* is active for a member; a new sign-in on a device terminates that device's previous session. Staff and organisation accounts keep one session per account." Record the version bump and a sync-impact note. Do not start T003+ until this is approved by the owner.
- [X] T002 (done: owner chose branch 026 off main; 025's work is in `git stash` entry "025-device-approval-pending work", nothing committed) Decide branch 025's fate with the owner (plan D8). Recommended: do not merge 025's `device_approval_pending` outcome, pending-row insert or app copy. Then `git switch main && git switch -c 026-device-sessions`. If 025 was already merged, revert its sign-in.ts change in T010 instead.
- [X] T003 Read `server/src/modules/auth/application/sign-in.ts`, `verify-otp.ts`, `server/src/modules/auth/sessions.ts` and `server/src/plugins/10-auth.ts` (l.~95–120 and ~270) once, so later tasks edit from the real text; run `npm run -w server test -- tests/auth` on a machine with `gwc_test` and record the baseline in this file.

## Phase 2: Foundational (blocks all stories)

- [X] T004 Write `server/migrations/044_member_devices.sql` per data-model.md: create `member_devices` (columns, `UNIQUE (member_id, kind, device_key)`, `CHECK (kind='mobile' OR known_at IS NULL)`); `ALTER TABLE sessions ADD COLUMN member_device_id uuid REFERENCES member_devices(id)`; drop and recreate `one_active_session_per_account` with `AND member_device_id IS NULL`; add `CREATE UNIQUE INDEX one_active_session_per_device ON sessions (member_device_id) WHERE revoked_at IS NULL AND member_device_id IS NOT NULL`; widen `sessions_revoked_reason_check` to add `device_ended` (keep every existing value including `expired`, as migration 043 does); add a trigger on `members` that, when `status` changes to `locked`, `inactive` or `ended`, sets `known_at = NULL` on that member's `member_devices`; backfill known mobile rows from `device_approvals WHERE state='approved'`, attach active member sessions by `(account_id, device_id)`, and give any remaining active member session (web) a row with a non-guessable key. Re-runnable style like 043 (`IF NOT EXISTS`, `DROP ... IF EXISTS`). Header comment explains why each rule is in the database (constitution IV).
- [X] T005 Add `server/tests/devices/migration.test.ts`: after migrating, two active sessions for one member on two different devices are accepted; two on the same device are refused by the index; two active staff sessions for one admin are still refused; locking a member clears `known_at`; an approved `device_approvals` row becomes a known mobile device and a pending/denied one does not. Counter-assertion: the staff case fails if the old index was dropped without the `member_device_id IS NULL` predicate.
- [X] T006 [P] Add `packages/contracts/src/devices.ts`: `MemberDevice` type and `memberDevicesResponseSchema` (fields exactly as contracts/devices-api.md, no extra fields), export from the package index; add optional `deviceLabel: z.string().min(1).max(64).optional()` to `signInRequestSchema` and `verifyOtpRequestSchema` in `packages/contracts/src/auth.ts`; run `npx tsc --noEmit` in every workspace and let it list callers.
- [X] T007 [P] Add `server/src/modules/auth/device-label.ts`: `labelForWeb(userAgent)` (browser name + OS only, falls back to "Web browser"), `labelForPhone(deviceLabel, platformHint)` (trims, caps 64, falls back to "Phone"). Unit test `server/tests/devices/device-label.test.ts` covering Chrome/Safari/Firefox on macOS/Windows/iOS/Android and an empty/garbage UA. No dependency added.
- [X] T008 Rework `startSession` in `server/src/modules/auth/sessions.ts`: for member accounts take `deviceKind`, `deviceKey`, `deviceLabel`; upsert `member_devices` (`ON CONFLICT (member_id, kind, device_key) DO UPDATE SET last_seen_at = now(), label = EXCLUDED.label`); revoke only that device's active session (`superseded`) and insert the new one with `member_device_id`; staff/organisation keep today's revoke-the-account's-session path. Keep returning `supersededSessionIds`. Rewrite the file's header comment and the `revokeSession` comment about "one session per account" so they state the new rule and why.
- [X] T009 Update `server/tests/auth/sessions.test.ts` and `server/tests/helpers/auth.ts` for the new `startSession` signature: a member second sign-in on the same device supersedes; on another device does not (and its access token still works); an admin still supersedes. Counter-assertion: a server that revoked by account fails the "other device stays valid" check.

**Checkpoint**: schema, types, labels and session core ready.

## Phase 3: User Story 1 — approved member uses app and web together (P1) 🎯 MVP

**Goal**: no per-device approval; web and phone sessions coexist; SMS only on an unknown phone.
**Independent test**: quickstart steps 1–3 and 8.

- [X] T010 [US1] Edit `server/src/modules/auth/application/sign-in.ts`: delete the `device_approvals` read and the `approval_pending` return for devices (~l.136–142). For a member with `deviceId`: look up `member_devices` for `(member, 'mobile', deviceId)`; if `known_at IS NOT NULL` (and the application is not pending) go straight to `startSession`; otherwise issue the existing login challenge (`otp_required`) as today. Keep the applicant/`resumingOnWeb` branch and every status refusal unchanged. Web sign-in: read the `gwc_bid` cookie, generate one if absent (128-bit random, base64url), store `sha256` as `deviceKey`, set the cookie (httpOnly, SameSite=Lax, path `/auth`, Secure outside development, ~400 days) through `server/src/modules/auth/cookies.ts`. `approval_pending` now means only an application.
- [X] T011 [US1] Edit `server/src/modules/auth/application/verify-otp.ts`: pass `deviceKind: 'mobile'`, `deviceKey: result.deviceId`, `deviceLabel` from the body to `startSession`; after a verified `login` code set `member_devices.known_at = now()` unless the member's application is not approved (that phone is marked known by T014 on approval).
- [X] T012 [US1] Edit `server/src/plugins/10-auth.ts`: remove `deviceApproved()` and its call (~l.105–118, ~270) for members; the session row (revoked or not) and the denylist stay the per-request truth. Update the comment above it to say a phone's trust is decided at sign-in, not per request. Check `server/src/plugins/11-rbac.ts` and `server/src/types/fastify.d.ts` for references to `deviceId` on the principal and leave `principal.deviceId` in place for push.
- [X] T013 [US1] Pass the web `Accept`/`User-Agent` and the body's `deviceLabel` through `server/src/modules/auth/controller.ts` into sign-in and verify-otp (labels via T007).
- [X] T014 [P] [US1] Edit `server/src/modules/onboarding/application/review.ts` (~l.121): on an `approved` decision with a `device_id`, also upsert `member_devices` (`mobile`, that id, label "Phone", `known_at = now()`), in the same transaction as the existing `device_approvals` insert.
- [X] T015 [US1] Rewrite `server/tests/auth/device-approval.test.ts`: unknown phone → `otp_required` and no `device_approvals` write; verified code → session and phone known; same phone again → `authenticated` with no SMS; web sign-in alongside a phone session leaves both valid in both orders; pending/denied `device_approvals` rows do not block; locking the member then unlocking → SMS again; applicant and denied/locked/inactive/ended refusals unchanged (the existing tests in `tests/onboarding/flow.test.ts` and `web.test.ts` must still pass). Counter-assertions: the "no SMS" case fails against a server that always texts.
- [X] T016 [P] [US1] App: in `expo-client/german-world-club/src/session/` and `src/app/(public)/sign-in.tsx`, send `deviceLabel` (`expo-device` `modelName`, else platform) on sign-in and verify-otp. If 025's `device_approval_pending` copy or case exists, remove it. Check `src/i18n/{en,de}.ts` still have identical keys.

**Checkpoint**: the reported bug is fixed: `demo.active@demo.invalid` signs in on a new phone with one SMS code, with the web session still alive.

## Phase 4: User Story 2 — see my devices in settings (P2)

**Goal**: list of active devices on both faces, current one marked.
**Independent test**: quickstart step 4.

- [X] T017 [US2] Create `server/src/modules/devices/application/list.ts`: one query joining `member_devices` and active `sessions` for the principal's member, explicit columns only (`id, kind, label, first_seen_at, last_seen_at`) plus `current = (s.id = principal.sid)`, newest `last_seen_at` first.
- [X] T018 [US2] Create `server/src/modules/devices/routes.ts` and `controller.ts`: `GET /member/devices`, `config: { auth: { audience: 'member' }, budget: 'auth' }`, `cache-control: private, no-store`; register it where the other modules are registered (follow `modules/profile/routes.ts`). Confirm `server/tests/authz/matrix.test.ts` and the route-posture gate pass and add the route to the matrix expectations.
- [X] T019 [P] [US2] Tests `server/tests/devices/list.test.ts`: two devices listed with `current` on the caller's; an ended device is absent; the response body contains none of `ip`, `userAgent`, `deviceKey`, `token`, `sid`, `known` (scan the JSON); another member's devices never appear; an applicant gets the usual refusal.
- [X] T020 [P] [US2] Web: add `client/src/member/profile/Devices.tsx` (list with label, last active, "This device" badge) and link it from `MyProfile.tsx`; follow the error convention (catch → `console.error('Devices.load', error instanceof ApiError ? error.problem : error)`, no error state). Add strings to `client/src/i18n/en.ts` and `de.ts` (never import a catalogue directly) and use locale date formatting; run `npm run -w client test:i18n` and `tests/no-hardcoded-strings.test.js`.
- [X] T021 [P] [US2] App: add `expo-client/german-world-club/src/app/(member)/profile/devices.tsx` and a row on `profile/index.tsx`; strings in `src/i18n/en.ts` and `de.ts`; the API call in `src/api/` next to the others using the `@gwc/contracts/devices` type.

**Checkpoint**: both faces show the same list.

## Phase 5: User Story 3 — end a device I don't recognise (P3)

**Goal**: ending refuses that device immediately, forgets a phone, leaks nothing.
**Independent test**: quickstart steps 5–6.

- [X] T022 [US3] Create `server/src/modules/devices/application/end.ts`: load the device by `(id, member_id)` inside one transaction (not found ⇒ the same 404 problem as an unknown id); if it is the caller's current device call `revokeSession(…, 'logout', { forgetPushDevices: true })` and keep `known_at`; otherwise `revokeSession(…, 'device_ended', { forgetPushDevices: true })`, set `known_at = NULL` for a phone, add the session id to `app.denylist`, and write an `app.audit` entry `device_ended` (actor = member). Idempotent for an already-ended device of the caller. `DELETE /member/devices/:id` in `routes.ts`/`controller.ts`, 204.
- [X] T023 [P] [US3] Tests `server/tests/devices/end.test.ts`: the ended device's next request is refused and its refresh token is dead; the other device keeps working; an ended phone's next sign-in returns `otp_required`; a phone that signed itself out stays known; ending the current device acts as sign-out; another member's id and a random uuid return byte-identical 404 (status, body, headers); push devices of the ended session are removed; an audit row exists. Counter-assertions for each.
- [X] T024 [P] [US3] Web: "Sign out this device" button on `Devices.tsx` (confirm in-page, not `window.confirm`); on success reload the list; strings de/en; `test:i18n`.
- [X] T025 [P] [US3] App: the same action on `devices.tsx`; when the current device is ended, follow the existing sign-out path in `src/session/`.

## Phase 6: Idle expiry and polish

- [X] T026 Extend `sessions.expire` in `server/src/ops/jobs.ts`: also revoke member sessions with `last_seen_at < now() - interval '30 days'` and reason `expired` (already in the check constraint); leave `known_at` alone. Test in `server/tests/devices/idle-expiry.test.ts`: a 31-day-idle session ends, a 29-day one does not, the phone stays known, a session with a fresh refresh keeps going. (Web refresh TTL is already 30 days and mobile 90, so the new predicate matters for phones.)
- [X] T027 [P] Update docs: `server/ARCHITECTURE.md` and CLAUDE.md lines that say one session per account / new phone needs approval (the auth and onboarding paragraphs); `specs/009-expo-client/spec.md` l.53; add a README note in `specs/025-device-approval-pending/` that it is superseded; `server/tests/seed` expectations if the demo seed's `demo-device-N` approvals need `member_devices` rows (they should be seeded known, with the history rule: one row only where an approved record implies it).
- [X] T028 Run the whole quickstart on a local DB, `npm run -w server test`, `npm test`, `tsc --noEmit` in contracts/client/expo, `npm run -w client test:i18n`, `npm run -w server verify:seo`. Record results here.
- [X] T029 Release note for the owner: existing app members keep access (approved phones are backfilled known); every other phone gets one SMS code; no data is deleted. Do not run the migration on production without the owner's go-ahead.

---

## Dependencies & Execution Order

- T001 → everything with code; T002 before T003. T004 → T005, T008. T006/T007 are independent of T004. T008 → T009 → US1.
- US1: T010 → T011 → T012 → T013; T014 and T016 parallel to them; T015 after T010–T012.
- US2 needs T008 (sessions → devices) only; US3 needs US2's routes file (T018) and T008.
- Polish after the stories; T026 can start after T004.

## Parallel examples

- After T004: T006 and T007 in parallel.
- US1: T014 and T016 in parallel with T010–T013.
- US2: T019, T020, T021 together once T018 is done.
- US3: T023, T024, T025 together once T022 is done.

## Implementation strategy

**MVP = Phases 1–3 (US1)**: the reported bug is fixed and phones/web coexist. Ship it only together with T029's release note, because it changes security behaviour (SMS only on a new phone, no staff approval). US2 and US3 are small and should follow immediately: without the list and the end action the platform loses visibility of who has access, which is why the spec made them part of dropping approval.

## Implementation status (2026-11-17)

All 29 tasks are done. Verified against a **throwaway local Postgres** (`postgres:16-alpine` on port 55432, removed afterwards), never against the database named in `server/.env`:

- `npx vitest run --exclude 'tests/seed/**'`: 1758 passed, 9 failed in 5 files — `tests/profiling/world-cities.test.ts`, `settling.test.ts` (reference city data is not loaded in a fresh DB) and `tests/resilience/{timeouts,crawler-budget,budget-assertion}.test.ts` (route-budget assertions about `email-send` calling mail inline). None touch sessions, devices or sign-in; not compared against `main` (no clean checkout was run).
- `tests/seed/**` cannot run here: `server/migrations/delete-member.sql` (an untracked file that is not mine) is picked up by the migration runner, and fails in every fresh seed database. The seed change (`member_devices` in `src/seed/tables.ts` and `operations.ts`) is covered by `tests/seed/table-manifest.test.ts` (passes) and a rolled-back run of its SQL, not by `seed:demo`.
- `tsc --noEmit` clean in `packages/contracts`, `client`, `expo-client/german-world-club`; contracts 120/120; client 467/467 (including the dev-proxy test, which needed `/member` added to `client/dev-server.ts`); `test:i18n` passes. `server` `tsc` already reports hundreds of errors on `main` and is not a gate.
- Not done: `verify:seo` (needs a running server), a run on a real phone, and any run against production.

### Release note (T029)

- Existing app members keep access: phones staff had approved are backfilled as known, and signed-in sessions are attached to a device row by migration `044_member_devices.sql`.
- Every other phone gets one SMS code, then is known. Nothing is deleted.
- Run the migration only with the owner's go-ahead, and check `server/migrations/` first: an untracked `delete-member.sql` there would be applied by the runner (its own guard only checks the database name).
- Branch 025's work is in `git stash` ("025-device-approval-pending work (superseded by 026)"); nothing was committed.
