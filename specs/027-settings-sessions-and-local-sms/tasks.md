---
description: "Tasks for 027: a Settings section in the web profile that lists and ends sessions, several phones at once, and the local SMS failure"
---

# Tasks: Profile Settings with active sessions, several phones, and the local SMS failure

**Input**: user requests (Settings section; multiple mobile devices; the pasted 503 "verification code could not be sent" log), feature 026 (committed as `3e2218e`, on `origin/026-device-sessions`), and a read of the code. This file merges the former `specs/027-profile-settings-sessions` and `specs/028-local-sms-failure`.
**Branch**: `027-settings-sessions-and-local-sms`, created from `origin/026-device-sessions` (026 is not merged to `main`).
**Tests**: included (CLAUDE.md: behaviour tests with a counter-assertion). Server suites run only against a throwaway local Postgres with an explicit `DATABASE_URL`; never against the URL in `server/.env`, which points at a remote host that matches `PRODUCTION_DATABASE_URL`.

## What is already true (do not rebuild)

026 already gives several simultaneous sessions per member (web plus any number of phones, one per device), `GET /member/devices`, `DELETE /member/devices/:id`, and a **Devices** page at `/konsole/mitglied/profil/geraete`, linked as "Devices" in `client/src/member/profile/MyProfile.tsx`. No new server route, table or migration is needed for US1 and US2.

## What the SMS log says (read from the code; nothing was run against any database)

- The stack is `signIn` at `server/src/modules/auth/application/sign-in.ts:159` → `app.sendOtp` (`server/src/decorators/send-otp.ts:69`) → `smsUnavailable()`. Line 159 is the new-phone branch added by 026: a phone with no `member_devices.known_at` gets an SMS code. So this is the intended path failing at the provider.
- `send-otp.ts` throws `smsUnavailable()` in two places: provider not configured, and provider rejected or unreachable. `server/.env` has `SMSGLOBAL_API_KEY`, `SMSGLOBAL_API_SECRET` (32 characters each) and `SMSGLOBAL_ORIGIN` (5 characters), and the stack points at the `catch`, which logs `SMS_PROVIDER_ERROR` with `providerStatus` and `providerResponse` just before the pasted line. That earlier line is the real reason and was not in the paste.
- Likely causes by `providerStatus`: 401/403 wrong key/secret or an IP allow-list; 400 with an `origin` error: sender id `SMSGLOBAL_ORIGIN` not registered; 400 with a `destination` error: the member's stored mobile is not deliverable (a seeded `@demo.invalid` member has a fake one); 402 or a credits message: no balance; no status and an ECONN/ENOTFOUND message: no network path.
- **Safety finding**: `server/.env` sets `DATABASE_URL` to a remote host (the same name as `PRODUCTION_DATABASE_URL`). A server started from that file on a laptop talks to the production database and sends real SMS to whatever number a member has. Fix that first (T004).

## Format: `[ID] [P?] [Story]` Description

- US1: a Settings section in the web profile, next to Edit profile, listing active sessions with a terminate action (P1)
- US2: one member signed in on several phones at once, each visible and individually terminable (P2)
- US3: find the real cause of the local SMS failure (P1)
- US4: development can sign in without a real SMS (P2)

---

## Phase 1: Setup

- [X] T001 `git switch -c 027-settings-sessions-and-local-sms --no-track origin/026-device-sessions` (done: this branch already exists at the same commit as `origin/026-device-sessions`, `3e2218e`). Confirm `git status` is clean apart from `specs/`, and that `client/src/member/profile/Devices.tsx`, `client/src/console/routes.tsx` (route `profil/geraete`) and `client/src/member/profile/MyProfile.tsx` (the "Devices" link) exist as described in "What is already true".
- [X] T002 Start a throwaway Postgres (`docker run -d --name gwc-027-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=gwc_test -p 55432:5432 postgres:16-alpine`), then in `server/` always prefix commands with `DATABASE_URL=postgres://postgres:test@localhost:55432/gwc_test`. `server/migrations/delete-member.sql` is now committed and is applied by the migration runner, but it refuses any database not named `german_world_club`; so before the first run execute `psql … -c "CREATE TABLE schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); INSERT INTO schema_migrations(filename) VALUES ('delete-member.sql')"` against `gwc_test`. Remove the container at the end.
- [ ] T003 In the terminal where `npm run -w server dev` is running, find the `SMS_PROVIDER_ERROR` (or `SMSGlobal is not configured — no code was sent`) log line printed immediately before request `01M7M3RFRY3BP9X4E52NY5WP7F`, and copy `route`, `destination` (already masked), `providerStatus` and `providerResponse` into this file under "Findings". Do not paste the API key, secret, or the unmasked number.
- [X] T004 Establish which database the local server is using without printing credentials: run `cd server && node -e "const u=new URL(process.env.DATABASE_URL);console.log(u.hostname,u.pathname)" --env-file=.env` (or the equivalent that reads `.env`) and record only the hostname and database name under "Findings". If it is the production host, stop using it for sign-in testing: copy `server/.env` to a local-only `.env.local` setup with `DATABASE_URL=postgres://localhost:5432/gwc_dev` (create `gwc_dev` with `createdb`, run `npm run -w server migrate` and `npm run -w server seed:dev` against **that** URL), and keep the production URL only in `PRODUCTION_DATABASE_URL`. Note in `server/README.md` (one short paragraph under the existing configuration notes) that a laptop `.env` must not point `DATABASE_URL` at production because SMS and mail then reach real members.

## Phase 2: Foundational

- [X] T005 Refactor `client/src/member/profile/Devices.tsx`: extract the list and terminate logic into an exported component `ActiveSessions` (same props-free behaviour, same `console.error('Devices.load' …)` conventions, same in-page confirm), keep `export default Devices` rendering only `<ActiveSessions />` so nothing breaks until T008. No visual change.

## Phase 3: User Story 1 — Settings section in the profile (P1) 🎯 MVP

**Goal**: in the web profile, next to "Edit profile", a "Settings" entry opens a Settings page whose first section is "Active sessions" (the 026 list) with a Terminate button per session; terminating the current one signs out.
**Independent test**: sign in on the web and on one phone; open Profile; click Settings; see both sessions with "This device" marked; terminate the phone; it disappears and that phone's next request is refused.

- [X] T006 [P] [US1] Create `client/src/member/profile/Settings.tsx`: a page titled by `t.memberSettings.title` with a section heading `t.memberSettings.sessionsHeading` and its explanatory text, rendering `<ActiveSessions />` from `Devices.tsx`. Layout follows `Privacy.tsx` (`mx-auto flex w-full max-w-2xl flex-col gap-8`). Leave room for further sections by giving each section its own `<section aria-labelledby=…>`.
- [X] T007 [P] [US1] Strings, both catalogues, same keys: in `client/src/i18n/en.ts` and `client/src/i18n/de.ts` add `memberProfile.settings` ("Settings" / "Einstellungen") and a `memberSettings` group with `title` ("Settings"/"Einstellungen"), `sessionsHeading` ("Active sessions"/"Aktive Sitzungen") and `sessionsIntro` ("These are the browsers and phones signed in to your account. Terminate any you do not recognise." / "Diese Browser und Handys sind bei Ihrem Konto angemeldet. Beenden Sie alle, die Sie nicht kennen."). Change the existing `memberDevices` button texts so the action reads "Terminate"/"Beenden" (`signOutDevice`, `signOutHere` → "Terminate this session"/"Diese Sitzung beenden", `confirmEnd` → "Confirm"/"Bestätigen"). Run `npm run -w client test:i18n` (must pass both directions).
- [X] T008 [US1] Wire it: in `client/src/console/routes.tsx` add `<Route path="profil/einstellungen" element={<Settings />} />` beside `profil/bearbeiten`, and change the existing `profil/geraete` route to `<Navigate to="../profil/einstellungen" replace />` so any bookmark of the 026 URL still works (import `Navigate` from `react-router`; check the relative path against the surrounding routes before relying on it). In `client/src/member/profile/MyProfile.tsx` replace the "Devices" link (`t.memberProfile.devices`) with a "Settings" link (`t.memberProfile.settings`) to `/konsole/mitglied/profil/einstellungen`, placed in the same actions row **immediately next to** the "Edit profile" link (order: Blocked & muted, Settings, Edit profile). Remove the now-unused `memberProfile.devices` key from both catalogues.
- [X] T009 [P] [US1] Client test `client/tests/member/settings.test.tsx` (follow the existing tests in `client/tests/member/` for render setup and API mocking): MyProfile renders a "Settings" link whose `href` ends in `/profil/einstellungen` and which sits in the same container as the "Edit profile" link; Settings lists the devices returned by a mocked `GET /member/devices`, marks the current one, and clicking Terminate then Confirm calls `DELETE /member/devices/<id>` and removes the row; Cancel calls nothing (counter-assertion); a failing load shows the load-failed callout and no list. Also keep `client/tests/no-hardcoded-strings.test.js` green.
- [ ] T010 [US1] Run `npm run -w client test`, `npx tsc --noEmit` in `client/`, `npm run -w client test:i18n`. Then, with the server and client dev servers running locally against the throwaway DB, click through the quickstart US1 scenario above in a browser and record the result here.

**Checkpoint**: the Settings section exists and ends sessions; nothing else changed.

## Phase 4: User Story 2 — several phones at once (P2)

**Goal**: prove one member can be signed in on three phones and a browser, each listed and individually terminable, with no cap and no cross-effects.
**Independent test**: the new server test below.

- [X] T011 [US2] Add `server/tests/devices/multi-device.test.ts` (use `buildOnboardingApp` from `tests/onboarding/helpers.ts` to capture SMS codes, as `tests/devices/end.test.ts` does): one member with a verified mobile signs in on `phone-a`, `phone-b`, `phone-c` (each answers its own SMS code) and on the web; assert all four sessions are valid at the same time (`GET /auth/me` 200 for each), `GET /member/devices` lists four entries with the right labels, terminating `phone-b` from `phone-a` leaves the other three valid and `phone-b` refused, and a fourth phone `phone-d` signs in without evicting anyone (no cap). Counter-assertion: against a server that still kept one session per account this test fails on the first `/auth/me`.
- [X] T012 [P] [US2] Add a second case in the same file: the **same** phone signing in twice stays one entry (the second sign-in replaces the first session), and two phones with different `deviceId`s but the same `deviceLabel` ("iPhone 15") are still two separate entries (identity is the device id, not the label). Run `DATABASE_URL=… npx vitest run tests/devices` and `tests/auth` and record the counts here.
- [X] T013 [US2] Check the Expo app signs in on a second phone without special handling: read `expo-client/german-world-club/src/session/storage.ts` `deviceId()` (a random UUID stored in SecureStore, per install) and confirm two installs get different ids; if a reinstall or restore-from-backup could copy the id between two phones, note it here as a known limit rather than changing it in this feature.

## Phase 5: User Story 3 — find the real cause of the SMS failure (P1) 🎯

**Goal**: name the single cause from T003 and fix the configuration, with no code change unless the cause is in the code.
**Independent test**: a code reaches a phone you own, from a local sign-in on a new `deviceId`.

- [ ] T014 [US3] From the T003 line, pick the matching cause above and act on it: wrong key/secret or IP allow-list → correct them in the SMSGlobal console and `server/.env` (never commit `.env`); unregistered sender → set `SMSGLOBAL_ORIGIN` to a sender id the account has registered, or register `B P`; fake destination → use a member whose `mobile` is a number you own (change it on the local DB only); no credits → top up; no network → check VPN/firewall. Record the cause and the fix under "Findings".
- [X] T015 [P] [US3] (no new script: `server/scripts/dev/send-test-otp.mjs` from feature 023 already does this and applies the country policy — use `node --env-file=.env scripts/dev/send-test-otp.mjs +<your number>`; a duplicate I wrote was removed) Add `server/scripts/dev/sms-probe.ts` and an npm script `dev:sms-probe` in `server/package.json`: `npm run -w server dev:sms-probe -- +<number you own>` loads env like `src/config/env.ts`, refuses to run when `NODE_ENV=production`, builds the client through `createSmsClient` (same code path as the gateway), sends a fixed probe text, and prints only `providerStatus`, the provider's `data` (masked destination) and elapsed ms. It must go through `src/integrations/sms.ts`, not a second SDK call site: `tests/auth/sms-gateway.test.ts` scans `src/` for other callers, so keep the script outside `src/` and have it import the client factory only.
- [ ] T016 [US3] Re-run the local sign-in on a new `deviceId` (use the app, or `curl -X POST localhost:<port>/auth/sign-in -d '{"email":…,"password":…,"deviceId":"probe-1"}'` against the **local** DB) and confirm `otp_required` and an SMS on the phone; then verify the code and confirm a second sign-in on `probe-1` returns `authenticated` with no SMS. Record the result.

**Checkpoint**: the provider answers, or the cause is named and owned by someone.

## Phase 6: User Story 4 — development without a real SMS (P2)

**Goal**: on a laptop, the new-phone sign-in works even with no SMS account, by logging the code, exactly as development mail is logged (`server/src/decorators/mail.ts`).
**Independent test**: with `NODE_ENV=development` and the new flag on, `POST /auth/sign-in` on a new phone returns `otp_required`, the server log contains the code, and `POST /auth/verify-otp` with it returns tokens.

- [X] T017 [US4] Add an opt-in env var `SMS_DEV_LOG` (boolean, default off) to `server/src/config/env.ts`, and make `env.ts` **throw at startup when `NODE_ENV=production` and `SMS_DEV_LOG` is set**, in the same place and style as the other production preconditions there. Add it, commented out, to `server/.env.example` with one line explaining it logs codes and must never be set anywhere real.
- [X] T018 [US4] In `server/src/integrations/sms.ts` add `createDevSmsSink({ log })` returning the same shape as `createSmsClient` (`name: 'sms'`, `provider: 'development-log'`, `configured: true`, `sendCode` that logs `{ destination: masked, code }` with the message `SMS (development: code logged)` and returns `{ delivered: true }`). In `server/src/decorators/integrations.ts` (where `createSmsClient` is built, ~l.15) choose it **only** when `env.NODE_ENV === 'development' && env.SMS_DEV_LOG`; every other case is unchanged. Leave `send-otp.ts` alone: the country policy and the single-gateway rule still apply to the sink because it sits behind `app.sendOtp`.
- [X] T019 [US4] Test `server/tests/auth/sms-dev-sink.test.ts`: (a) with the flag and `NODE_ENV=development` a sign-in on a new phone yields `otp_required`, the captured log entry contains the 4-digit code, and verifying it succeeds; (b) the real SDK factory is never called in that mode (inject a throwing `sdkFactory` as the existing gateway tests do); (c) with `NODE_ENV=test` and the flag set, the real client is still used (counter-assertion: a sink that ignores the environment fails here); (d) starting with `NODE_ENV=production` and the flag set refuses to boot with a message naming `SMS_DEV_LOG`; (e) a destination on the sanctions denylist is still refused with 422 `sms-destination-not-allowed` while the sink is on. Run `npx vitest run tests/auth` against a throwaway DB, plus `tests/auth/sms-gateway.test.ts` unchanged.

## Phase 7: Polish

- [X] T020 [P] Update `CLAUDE.md` in the "A member is signed in per device" paragraph: the member's sessions are managed at `/konsole/mitglied/profil/einstellungen` (Settings in the profile); the old `profil/geraete` URL redirects there. Update `specs/026-device-sessions/quickstart.md` step 4–5 wording to name the Settings page.
- [X] T021 [P] Add two sentences to `CLAUDE.md` in the "Every SMS goes through one gateway" paragraph: `SMS_DEV_LOG` exists, is development-only, and boot fails if it is set in production; and a laptop `.env` must not point at the production database. Mention the same in `server/README.md`.
- [X] T022 Final run: `npm run -w client test`, `npx vitest run --exclude 'tests/seed/**'` in `server/` against the throwaway DB, `tsc --noEmit` in `packages/contracts`, `client`, `expo-client/german-world-club`. Remove the throwaway container. Do not commit unless asked.

---

## Findings (fill in during T003, T004, T014)

- `SMS_PROVIDER_ERROR`: route=…, providerStatus=…, providerResponse=…
- Database host/name used by the local server: …
- Cause and fix: …

## Dependencies & Execution Order

T001 → T002 → T005. T003 → T004 → T014 → T016; T015 can run any time after T001. US1 (T006–T010) needs T005. US2 (T011–T013) needs only T002. US4 (T017 → T018 → T019) does not depend on the SMS diagnosis. T020–T022 last.

## Parallel examples

- After T005: T006 (Settings.tsx) and T007 (strings) together.
- Alongside US1: T011 (server multi-device test), T013 (app read-through), T015 (probe script).
- US4 can run in parallel with US1 and US3.

## Implementation strategy

**MVP = Phase 1–3 (US1) plus US3**: US1 is purely a web-client change; US3 is usually a one-line configuration fix plus moving the laptop off the production database. US2 adds proof, not behaviour. US4 matters regardless of the diagnosis: without it nobody without a working SMSGlobal account (or with a seeded fake number) can sign in on a "new" phone locally, which 026 made the normal first step for every phone.

## Implementation status (2026-11-17)

**Done (18 of 22):** T001, T002, T004, T005–T009, T011–T013, T015, T017–T022.
**Left open, needs you:** T003 (the `SMS_PROVIDER_ERROR` line from your terminal), T010's manual browser click-through, T014 (act on T003's finding) and T016 (a real SMS to a phone you own). I cannot read your server terminal or receive an SMS.

Findings so far (T004): `server/.env` has `DATABASE_URL` pointing at `mgox.your-database.de/german_world_club`, **the same host and database as `PRODUCTION_DATABASE_URL`**. A server started from that file on your laptop uses production data and sends real SMS/mail. I did not change your `.env`; to move off it: `createdb gwc_dev`, point `DATABASE_URL` at `postgres://localhost:5432/gwc_dev`, then `npm run -w server migrate` and `npm run -w server seed:dev`, and keep the production URL only in `PRODUCTION_DATABASE_URL`. (Note `server/migrations/delete-member.sql` is committed in `migrations/`; its own guard only allows the database named `german_world_club`.)

Verification (throwaway `postgres:16-alpine` on port 55432, now removed; never the `.env` database):
- Server, excluding `tests/seed/**`: 1768 passed, 9 failed in the same 5 files as on 026 (`profiling/world-cities`, `profiling/settling`, `resilience/{timeouts,crawler-budget,budget-assertion}`), none touching sessions, devices or SMS.
- New: `tests/devices/multi-device.test.ts` (2), `tests/auth/sms-dev-sink.test.ts` (8); the single-gateway scan in `tests/auth/sms-gateway.test.ts` still passes.
- Client: `tests/member/settings.test.tsx` (5) passes; the full client run was 471/472 once, with `tests/console/admin-referrals.test.tsx` failing, then passing alone twice, so it looks timing-flaky and unrelated. `tsc --noEmit` clean in contracts, client and the Expo app; `test:i18n` passes.
- T013: the app's `deviceId()` is a random UUID per install in SecureStore, so two installs get different ids. Known limit (now in a code comment): SecureStore's default keychain class can be restored from an encrypted iOS backup, so a phone restored from another phone's backup shares its id.
- Constitution note for T017–T019: the dev sink prints a one-time code, which the constitution says must not appear in logs. It writes a plain console line (not the structured logger), needs `NODE_ENV=development` plus the explicit flag, and boot refuses it in production. That is the same bargain as development mail and `seed:demo`, taken knowingly.

## Update (2026-11-17, after the owner's reply)

The owner confirmed `send-test-otp.mjs` sends fine from the laptop (SMSGlobal accepted a UAE number), so the provider, key, secret and sender id are working; the earlier 503 most likely came from the member's stored number (a seeded `@demo.invalid` member has a fake one). T003/T014 can be closed by checking that member's `mobile` on a **local** database, not by changing credentials. Requested changes, done:

- **US4 reworked**: in development the code is printed in the terminal **and** the real SMS is still sent (cost is not a concern); a provider refusal is printed and no longer fails sign-in; `SMS_DEV_LOG` is now **on by default when `NODE_ENV=development`** (`false` turns it off) and production still refuses to boot with it `true`. It lives inside `createSmsClient` (`development` option), so the single-gateway scan in `tests/auth/sms-gateway.test.ts` is unchanged. Tests: `tests/auth/sms-dev-sink.test.ts` (12).
- **Constitution 4.0.0** (MAJOR: a MUST is downgraded): Principle VI gets a development-only exception for one-time codes in the terminal, with a sync impact report.
- **Profile links**: "Blocked & muted" and "Settings" now use `rounded-card border border-hairline px-3 py-1.5 font-semibold text-text hover:bg-ground`, like "Edit profile".
- Server (without seed suites): 1772 passed, the same 9 unrelated failures. Client: full suite and `tsc` run clean (see report).
