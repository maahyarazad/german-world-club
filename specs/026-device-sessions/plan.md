# Implementation Plan: Device sessions, without a separate device approval

**Branch**: `026-device-sessions` (the branch is not created yet; `git switch -c` from `main` once 025 is dealt with, see D8) | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

## Summary

Stop treating "one account = one session" and "one phone needs staff approval" as platform rules. A member gets one
*device* row per browser or phone and at most one active session per device. Sign-in no longer ends other devices;
the per-request device-approval gate is removed; a phone that has passed the SMS code once is *known* and later signs in
with the password alone; ending a device from the member's own list ends its session and forgets it. The list and the end
action are two member routes, shown in profile settings on the web console and in the app. Sessions idle 30 days end by
the existing `sessions.expire` job.

## Technical Context

**Language/Version**: Node 22, Fastify 5, TypeScript in `server/src` (the CLAUDE.md "no TypeScript" line predates feature 007); Zod types from `packages/contracts`
**Primary Dependencies**: existing only (pg, argon2, pg-boss). No UA-parsing library: a ~30-line label function (D5). App uses `expo-device` and `expo-constants`, already installed.
**Storage**: PostgreSQL. New migration `044_member_devices.sql`; `sessions` altered; `device_approvals` kept, no longer read at sign-in.
**Testing**: vitest, SQL suites against `gwc_test` (skip loudly without a DB), counter-assertions per CLAUDE.md
**Target Platform**: Linux server; web console (`client/`); Expo SDK 57 app
**Project Type**: web-service + web client + mobile client (monorepo workspaces)
**Performance Goals**: sign-in and refresh add at most one indexed read/write; list is one indexed query (a member has tens of rows at most)
**Constraints**: route deadlines as today; no IP, token or secret in the list response (Principle VI); 404 never 403 for another member's device
**Scale/Scope**: ~5k members, a few devices each

## Constitution Check

*Gate: checked against `.specify/memory/constitution.md` v2.0.0.*

| Principle | Result |
|---|---|
| I One rule set | PASS. "Known phone", expiry and forgetting are server rules; clients only render the list. Types live in `@gwc/contracts`. |
| II Declare posture | PASS. Two new routes declare `config.auth` (member audience). Ownership refusals are 404 (loaded target, inside the query). |
| III Published = real | N/A (gated surface, never indexed; no public page changes). |
| IV Integrity in the DB | PASS. "One active session per device" is a partial unique index, replacing the account-wide one for members. Known/forgotten is a column, not an application flag. Member rows still never deleted. |
| V Failure explicit | PASS. New routes use the `auth` budget; no new outbound call. |
| VI Server shapes output | PASS. Explicit column list; no IP, token, device key or user agent in the response (only a derived label). |
| Technology baseline: "At most one session per account is active; a new sign-in terminates the previous one." | **FAIL, justified.** The feature exists to change exactly this sentence. |

**Required before implementation**: amend the constitution with `/speckit-constitution`, replacing that sentence with
"At most one session per *device* is active; a new sign-in on a device terminates that device's previous session. Staff
and organisation accounts keep one session per account." The clause is narrowed, not removed, and Principle IV's
"session uniqueness by constraint" still holds. Whether that is a MINOR or MAJOR bump is the amendment's call. Tasks
that touch code are blocked on it (task T001 in the next `/speckit-tasks`).

### Complexity Tracking

| Departure | Why needed | Simpler alternative rejected |
|---|---|---|
| Relaxing one-session-per-account (§12.7) | Web and phone must work at the same time (US1) | Keeping it and exempting only mobile: still ends the web session whenever the phone signs in, which is the complaint |
| A `member_devices` table beside `sessions` | "Known phone" must outlive a session, and sessions are revoked rows | A `known` flag on `sessions`: lost the moment the session ends, so sign-out would forget the phone, contradicting spec Q1/Q2 |
| Per-browser cookie | Web has no device id; without one every browser is one "Web" entry (spec Q3 chose per-browser) | UA-only identity: two Chrome windows on one Mac collide |

## Project Structure

### Documentation (this feature)

```text
specs/026-device-sessions/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/devices-api.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
server/migrations/044_member_devices.sql        # table, sessions.member_device_id, indexes, reasons, backfill
server/src/modules/auth/sessions.ts             # startSession per device; revoke helpers; forget-on-account-events
server/src/modules/auth/application/sign-in.ts  # known-phone path; no approval branch; browser cookie
server/src/modules/auth/application/verify-otp.ts # mark phone known after a verified code
server/src/modules/auth/device-label.ts         # UA / app label -> short display string
server/src/plugins/10-auth.ts                   # remove deviceApproved() gate for members
server/src/modules/devices/{routes,controller}.ts + application/{list,end}.ts   # GET/DELETE /member/devices
server/src/modules/onboarding/application/review.ts   # approving an application marks its phone known
server/src/ops/jobs.ts                          # sessions.expire also ends 30-day idle sessions
packages/contracts/src/{auth,devices}.ts        # optional deviceLabel; device list/response types
client/src/member/…                             # settings: devices list + end button (+ i18n de/en)
expo-client/german-world-club/src/app/(member)/profile/devices.tsx   # list + end (+ i18n de/en)
server/tests/devices/ , tests/auth/{device-approval,sessions}.test.ts updated
```

**Structure Decision**: a new `modules/devices/` (routes/controller/application) per the repo layout rules; session
lifecycle stays in `auth/sessions.ts` because sign-in, refresh and revocation already live there.

## Design decisions (detail in research.md)

- **D1** Device = row in `member_devices` keyed `(member_id, kind, device_key)`; session points to it.
- **D2** Uniqueness: `UNIQUE (member_device_id) WHERE revoked_at IS NULL`; the old account-wide partial index is narrowed to rows with no device (staff, organisations).
- **D3** Known phone: `member_devices.known_at`; set after a verified SMS code, at application approval, and by backfill from approved `device_approvals`; cleared when the member ends the device, and for all of a member's phones on lock/ended/inactive and password reset.
- **D4** Web browser id: random value in an httpOnly cookie, stored as its SHA-256.
- **D5** Labels: web from User-Agent by a small mapper; phone from an optional `deviceLabel` the app sends (`expo-device` model name), falling back to platform.
- **D6** Idle expiry: `last_seen_at < now() - 30 days` in `sessions.expire`; `last_seen_at` already moves on every refresh.
- **D7** Ending the *current* device from the list behaves as a plain sign-out (keeps it known), matching spec scenario 3.2 and the rule that a self sign-out keeps the phone known.
- **D8** Branch 025's pending-approval row and `device_approval_pending` outcome are superseded. Recommended: drop them (never reach `main`), keeping only the contract-copy fix if wanted. Needs the owner's yes.

## Re-check after design

Same table as above; no new failures. The single FAIL is the amendment above.
