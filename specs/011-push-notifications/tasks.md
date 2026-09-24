---

description: "Task list for feature 011 — Push Notifications"
---

# Tasks: Push Notifications

**Input**: Design documents from `/specs/011-push-notifications/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/http-api.md, contracts/push-payload.md, quickstart.md

**Tests**: Included. The constitution requires an automated check per principle, and plan.md names the suites. Per `CLAUDE.md`, every test asserts behaviour and carries a counter-assertion, so it can't pass against a server that does nothing. Write each story's tests first and watch them fail.

**Organization**: Grouped by user story from spec.md. The send pipeline (outbox) is foundational, because every story's independent test ends with a notification arriving on a phone.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 from spec.md
- Paths are repository-relative. The server is plain TS under native type stripping, and no `SELECT *` is allowed on any path that reaches a response.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, build configuration and secrets hygiene.

- [X] T001 Install `expo-notifications` with `npx expo install expo-notifications` in `expo-client/german-world-club/` (updates `expo-client/german-world-club/package.json` and the root `package-lock.json`)
- [X] T002 Add `"expo-notifications"` to `plugins` with `{ "icon": "./assets/notification-icon.png", "color": "#000000", "defaultChannel": "default" }`, and add `"googleServicesFile": "./google-services.json"` under `android` in `expo-client/german-world-club/app.json` (research R9)
- [X] T003 [P] Add a monochrome 96×96 white-on-transparent Android notification icon at `expo-client/german-world-club/assets/notification-icon.png`
- [X] T004 [P] Add `expo-client/german-world-club/google-services.json` (Firebase **client** config for package `com.germanworldclub.app`; committed, not a secret). If the file isn't available yet, leave a blocking `TODO(owner)` note in `specs/011-push-notifications/quickstart.md` prerequisites instead of inventing one
  - *Done by the fallback:* the file isn't in the repo, so a blocking `TODO(owner)` note is in quickstart.md prerequisites.
- [ ] T005 [P] Delete the stray service-account key `expo-client/german-world-club/german-world-club-b103ddfadefe.json`. Add `*-firebase-adminsdk*.json` and `german-world-club-*.json` patterns to `expo-client/german-world-club/.gitignore` and `.gitignore` so a future download can't be committed (research R8)
  - *Partly done:* the ignore patterns are added. The key file is **not deleted yet**. It's untracked and already ignored, and it may still need uploading to EAS first; waiting on the owner's go-ahead.
- [ ] T006 Run `npx expo prebuild --clean --platform android` in `expo-client/german-world-club/` and confirm `android/app/google-services.json` exists and `com.google.gms.google-services` is applied in `android/app/build.gradle`. Don't commit `android/` (it's ignored, CNG)
  - *Blocked on T004's file.* `app.json` names `./google-services.json`, so prebuild fails until the file is added.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contracts, schema, config and the persisted send pipeline that every story uses.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Contracts and schema

- [X] T007 Rewrite `packages/contracts/src/push.ts` per contracts/http-api.md and contracts/push-payload.md:
  - `DESTINATION_TYPES` becomes `['offer','listing','thread_post','event','partner','article','none']`
  - add `PUSH_LOCALES`, `NOTIFICATION_KINDS`, `NOTIFICATION_STATUSES` and `DELIVERY_STATUSES`
  - `deviceRegistrationSchema` gains a required `locale`; add `devicePatchSchema`
  - `campaignRequestSchema` becomes `{ clientRef: uuid, de:{title,body}, en:{title,body}, destination? }`
  - add `notificationSchema` / `notificationListSchema`, `audienceQuerySchema` / `audienceSchema` and `preferencesSchema`
  - add `OFFER_PUSH_TEMPLATE` and `PUSH_PAYLOAD_VERSION = '1'`
  - export TS types for each
- [X] T008 [P] Create `packages/contracts/src/offers.ts` with the `MemberOffer` schema and type (contracts/http-api.md). Add the `./offers` export to `packages/contracts/package.json`
- [X] T009 [P] Add the problem types `push/no-test-recipients` (409) and `push/idempotency-conflict` (409) to `packages/contracts/src/errors.ts`
- [X] T010 Write `server/migrations/028_push_outbox.sql` per data-model.md:
  - `push_devices`: dedupe tokens (keep the newest `last_seen_at`), swap to `UNIQUE (token)`, add `locale`, `session_id` and `disabled_reason`
  - create `member_push_preferences`
  - rename `push_campaigns` → `push_notifications` and add the `push_kind` / `push_status` enums, `idempotency_key UNIQUE`, `title_de/body_de` (renamed), `title_en/body_en`, `offer_id`, `audience`, `not_before`, `created_at`, `finished_at`, `lease_until`, with back-fills and the generated `is_test`
  - add `payload_hash text` to `push_notifications` (sha256 of the canonical `{kind, de, en, destination}`; NULL for offer rows)
  - rename `push_campaign_recipients` → `push_deliveries`: drop `token`, add `push_delivery_status` (`pending, sending, sent, delivered, failed, skipped`), `attempts`, `next_attempt_at`, `provider_ref`, `locale`, `updated_at`, PK `(notification_id, device_id)`, device FK `ON DELETE SET NULL`, and the two partial indexes
  - add a final-state guard trigger on `push_notifications`
  - add comments explaining *why* in the house style
- [X] T011 [P] Add `pushExpo` and `pushFcm` to `server/src/config/breakers.ts` (timeout 10 s, fallback `'retry-later'`, `retrySafe: true`, a `why`). Add `pushExpo`/`pushFcm` to `OUTBOUND` in `server/src/config/budgets.ts` without adding them to any route's `calls`. Change `errorFilter` so `DeviceNotRegistered` / `UNREGISTERED` don't trip the breaker (research R7)
- [X] T012 [P] In `server/src/config/env.ts`, refuse boot when `NODE_ENV=production` and `EXPO_ACCESS_TOKEN` is unset. Refuse boot in any environment when only some of `FCM_PROJECT_ID` / `FCM_CLIENT_EMAIL` / `FCM_PRIVATE_KEY` are set. Each message names the variable (research R8, FR-030)

### Send pipeline (outbox)

- [X] T013 Create `server/src/modules/push/application/audience.ts` exporting `ELIGIBLE_DEVICE` (the single eligibility SQL fragment: device enabled and not `disabled_reason`, member `active`, application approved or absent, test-list join for `audience='test'`, `COALESCE(pref.<audience>, true)` otherwise) plus `countAudience(app, { audience })`. Comment it like `VISIBLE_POST`: it's the only copy of this rule
- [X] T014 Extend `server/src/modules/push/providers.ts`:
  - `sendExpo` sends `channelId: 'default'` and returns per-token `providerRef` (the ticket id) and a `permanent` flag for `DeviceNotRegistered`
  - `sendFcm` flags `UNREGISTERED`/404 as permanent
  - add `fetchExpoReceipts({ ids, accessToken, send })` (chunked at 1,000)
  - wrap both transports in the `pushExpo` / `pushFcm` breakers
  - add `createLoggingTransport(log)` for development without credentials. It logs `tokenPreview` only, never the token
- [X] T015 Create `server/src/modules/push/application/dispatch.ts` (research R1):
  - `dispatchDue(app, { transport, config, batchSize = 100 })` claims due notifications (`status IN ('queued','sending') AND not_before <= now()`, lease with `FOR UPDATE SKIP LOCKED`)
  - for `kind='offer'`, re-checks the offer is `published` and valid, else marks it `cancelled`, then renders `OFFER_PUSH_TEMPLATE` from `offers.title` and `organisation_profiles.display_name` into `title_*/body_*` (truncating with an ellipsis)
  - materialises deliveries with `INSERT … SELECT … ${ELIGIBLE_DEVICE} ON CONFLICT DO NOTHING`
  - claims due `pending` deliveries in batches, and in the **same statement** sets them to `sending` with `updated_at = now()`. Eligibility is re-checked at claim time (ineligible → `skipped`)
  - sends outside any transaction, choosing the locale per device, with the payload `data {v,nid,type,id}`
  - records outcomes, from `sending` only: `sent` + `provider_ref`; permanent → `failed` + device `disabled_reason='unregistered'`; transient (the provider refused or couldn't be reached, so the message definitely wasn't accepted) → back to `pending` with `attempts+1` and a backoff `next_attempt_at`, and `failed` after 5 attempts
  - **never resends a delivery whose outcome is unknown** (spec SC-002, FR-028; research R2). At the start of every run, rows left in `sending` for longer than the lease (5 min) become `failed` with `error_message = 'outcome unknown'` and are never retried. A comment explains why: at most once per device beats a phone buzzing twice
  - paces sends with the exported constants `BATCH_SIZE = 100` and `BATCH_PAUSE_MS = 1000` (at most about 600 messages a minute, so 5,000 devices take about 8.5 min, within SC-002; constitution V)
  - finishes as `done` / `partial` / `failed`, sets `finished_at` and recomputes totals
- [X] T016 Create `server/src/modules/push/application/receipts.ts` with `checkReceipts(app, { transport, config })`. It fetches Expo receipts for `sent` deliveries older than 15 min and younger than 24 h, marks `delivered` or `failed`, and disables devices on `DeviceNotRegistered` (research R6)
- [X] T017 Create `server/src/modules/push/application/enqueue.ts`:
  - `enqueueNotification(app, { kind, audience, clientRef, de, en, destination, principal, requestId })` computes `payload_hash` (sha256 of canonical JSON `{kind, de, en, destination}`), inserts with `ON CONFLICT (idempotency_key) DO NOTHING RETURNING`, and falls back to a select
  - on conflict: the same hash returns `{ row, created: false }` (the route answers 200). A **different** hash throws `push/idempotency-conflict` (409), and nothing is queued or audited
  - it writes the audit entry `push_<kind>_queued` only when `created`
  - **after commit** it calls `kickDispatch(app)`, which does `app.boss.send('push.dispatch', {}, { singletonKey: 'push.dispatch' })`, catching and logging failures. The kick carries no notification id, because the job it triggers sends everything that's due (T018)
  - add `toNotification(row)` with explicit columns
- [X] T018 Expose the existing `PgBoss` instance once as `app.boss` from `server/src/modules/media/queue.ts`, and declare the decorator in `server/src/types/fastify.d.ts`. Create `server/src/modules/push/queue.ts`, which registers the pg-boss worker `push.dispatch` whose **only** action is `await app.runJob('push.deliver')` (research R1, analysis D1). So:
  - disabling `push.deliver` in `job_definitions` stops **every** send path
  - every kick is written to `job_runs` with its start, end and outcome
  - there's one dispatch code path

  Add a comment stating why the worker must not call `dispatchDue` directly. `croner`'s `protect: true` and the lease keep a kick and a cron tick from overlapping
- [X] T019 Add `push.deliver` (`* * * * *`, `dispatchDue`) and `push.receipts` (`*/15 * * * *`, `checkReceipts`) to `PLATFORM_JOBS` and `createJobHandlers` in `server/src/ops/jobs.ts`. Choose the transport from env (real, or the logging transport in development without credentials)
- [X] T020 Delete `server/src/modules/push/application/campaign.ts` once T017 and T015 replace it. Update imports in `server/src/modules/push/controller.ts`

### Foundational tests

- [X] T021 [P] `server/tests/push/persist-before-notify.test.ts`: the transport stub asserts the `push_notifications` row is committed before its first call, **and** that the HTTP response returns before any transport call (counter-assertion: the stub *is* called once the job runs). With the kick enabled, the stub is called within 5 s of the `202` (SC-001)
- [X] T022 [P] `server/tests/push/dispatch.test.ts`:
  - two concurrent `dispatchDue` calls produce no duplicate `(notification_id, device_id)`
  - a transient failure retries and then succeeds
  - after 5 failures the delivery is `failed` and the notification `partial`
  - a permanent failure disables the device
  - a member locked mid-broadcast is `skipped`
  - an audience of 0 ends `done`
  - **kill switch**: with `push.deliver` disabled in `job_definitions`, neither a kick nor a tick calls the transport. Counter-assertion: re-enabling it delivers, and each kick leaves a `job_runs` row
  - **outcome unknown**: a delivery left in `sending` past the lease becomes `failed` / `outcome unknown` and the transport is **not** called for it again. Counter-assertion: a delivery that transiently failed back to `pending` *is* retried
  - **provider split** (FR-026): an `expo` device is never sent through FCM and an `fcm` device never through Expo
- [X] T023 [P] `server/tests/push/audience.test.ts`: `ELIGIBLE_DEVICE` excludes locked members, unapproved applicants, disabled devices, devices with `disabled_reason`, and opted-out preferences; it includes an eligible device (counter-assertion)
- [X] T024 [P] `server/tests/push/receipts.test.ts`: a `DeviceNotRegistered` receipt disables the device, and an `ok` receipt marks it `delivered`
- [X] T025 [P] Extend `server/tests/resilience/breaker-errorfilter.test.ts` and `breaker.test.ts`: dead-token errors don't trip `pushExpo`, and 5xx errors do. With the breaker open, deliveries stay `pending` and no request fails
- [X] T026 [P] Extend the env tests (where `server/src/config/env.ts` is already tested, or a new `server/tests/ops/push-env.test.ts`): production without `EXPO_ACCESS_TOKEN` refuses, partial FCM refuses, and a full or empty FCM set boots
- [X] T027 [P] Extend `server/tests/ops/logging-redaction.test.ts`: run a dispatch with the logging transport and a failing transport, and assert no log line contains `ExponentPushToken[` or a full registered token

**Checkpoint**: `npm run -w server migrate && npm run -w server test -- tests/push tests/resilience tests/ops` is green, and a notification inserted by hand is delivered by the job.

---

## Phase 3: User Story 1 - An approved member receives notifications on their phone (Priority: P1) 🎯 MVP

**Goal**: Only approved members are asked once. The device is registered, refreshed and moved between members correctly, removed on sign-out, and notifications are shown in the foreground.

**Independent Test**: Approve a test applicant, open the dev build and accept the prompt. `GET /push/devices` shows one device with the right locale. A notification queued by hand for that device (or a rehearsal from Phase 5) arrives. quickstart rows 1–3 and 13.

### Tests for User Story 1

- [X] T028 [P] [US1] `server/tests/push/devices.test.ts`:
  - register upserts on token
  - the same token from member B moves the row to B, and A's list is empty (counter-assertion: B's list has it)
  - `locale` is required and stored
  - PATCH changes `enabled`/`locale`, and another member's id gets 404, indistinguishable from an absent id
  - re-registering clears `disabled_reason`
- [X] T029 [P] [US1] `server/tests/push/onboarding-gate.test.ts`: an applicant with a `pending` application gets refused by `POST /push/devices` with the onboarding problem. An approved member and a member with no application row both succeed
- [X] T030 [P] [US1] `server/tests/push/sign-out.test.ts`: `POST /auth/sign-out` deletes devices whose `session_id` is the revoked session, and leaves the member's device from a different session in place
- [X] T031 [P] [US1] `server/tests/push/preferences.test.ts`: `GET` with no row returns both `true`, and `PUT` round-trips. A member with `offers=false` is excluded from an `offers` audience and still included in `broadcasts`
- [X] T032 [P] [US1] Add the new member routes (`PATCH /push/devices/:id`, `GET/PUT /push/preferences`) to `server/tests/authz/matrix.test.ts` × every principal kind

### Implementation for User Story 1

- [X] T033 [US1] Update `server/src/modules/push/application/devices.ts`: upsert `ON CONFLICT (token)` reassigning `member_id`, set `session_id` from the principal, and store `locale`. Add `updateDevice` (owner-scoped, 404 otherwise). `toDevice` includes `locale`. Name the columns explicitly
- [X] T034 [P] [US1] Create `server/src/modules/push/application/preferences.ts` with `getPreferences` / `putPreferences` (upsert into `member_push_preferences`)
- [X] T035 [US1] In `server/src/modules/push/routes.ts` and `controller.ts`, update `POST /push/devices` to the new schema and add `PATCH /push/devices/:id` and `GET/PUT /push/preferences`. All are `auth: { audience: 'member' }` without `onboarding`, budget `member-read`/`member-write`, and declare their buckets
- [X] T036 [US1] In `server/src/modules/auth/application/sign-out.ts`, delete `push_devices WHERE session_id = $revoked` in the same transaction as the revocation, with a comment saying why (research R3)
- [X] T037 [P] [US1] Add `push.devices.register/patch/remove` and `push.preferences.get/put` to `expo-client/german-world-club/src/api/endpoints.ts`, typed from `@gwc/contracts/push`
- [X] T038 [P] [US1] Create `expo-client/german-world-club/src/notifications/setup.ts`: `Notifications.setNotificationHandler` (`shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false`) and `ensureAndroidChannel()` (`setNotificationChannelAsync('default', …)`), imported once from the root layout
- [X] T039 [US1] Create `expo-client/german-world-club/src/notifications/registration.ts`:
  - `useDeviceRegistration()` is active only when `useSession().state.status === 'member'`
  - on first reaching member, if the "asked" flag isn't set: show the explanation sheet, then `ensureAndroidChannel()`, then `requestPermissionsAsync()`, then set the flag (secure store, in `src/session/storage.ts` / `storage.web.ts`)
  - when granted, call `getExpoPushTokenAsync({ projectId: Constants.expoConfig.extra.eas.projectId })` and `POST /push/devices` with `provider:'expo'`, the platform and `locale`, on every cold start
  - re-register from `addPushTokenListener` and whenever `useTranslations().locale` changes
  - keep the device id for sign-out
  - does nothing on web (`Platform.OS === 'web'`) and on simulators without push support (`expo-device`)
- [X] T040 [US1] Create the explanation sheet component `expo-client/german-world-club/src/components/notification-prompt.tsx` (pre-permission copy, **Allow** / **Not now**). "Not now" also sets the asked flag (FR-002)
- [X] T041 [US1] In `expo-client/german-world-club/src/session/session.tsx`, `signOut` calls `DELETE /push/devices/:id` for the stored device id **before** `authApi.signOut()` and forgetting credentials, and swallows errors (the server-side cleanup from T036 covers failures)
- [X] T042 [US1] Create `expo-client/german-world-club/src/app/(member)/profile/notifications.tsx`:
  - a master switch (the device's `enabled` via PATCH; when the OS permission is denied and `canAskAgain` is false, it opens `Linking.openSettings()`)
  - **Offers** and **Club news** switches (`PUT /push/preferences`)
  - a link to it from `src/app/(member)/profile/index.tsx`
- [X] T043 [US1] Mount `useDeviceRegistration()` and the prompt in `expo-client/german-world-club/src/app/_layout.tsx` inside `SessionProvider`/`I18nProvider`, and import `src/notifications/setup.ts` at module scope
- [X] T044 [P] [US1] Add `notifications.*` strings (prompt title and body, allow, not now, settings labels, system-settings hint) to `expo-client/german-world-club/src/i18n/en.ts` and `de.ts`, with the same keys in both

**Checkpoint**: US1 is independently demonstrable (quickstart 1–3, 13), and the server suites for US1 are green.

---

## Phase 4: User Story 2 - Tapping a notification opens the right screen (Priority: P1)

**Goal**: Every destination opens from cold start, background and foreground. Absent items show "not available". A signed-out tap resumes after sign-in.

**Independent Test**: Queue one notification per destination type for a test device (by hand or with a rehearsal) with the app closed. Each tap opens the matching screen, and Back returns to that tab's root. quickstart rows 5–6.

### Tests for User Story 2

- [X] T045 [P] [US2] `server/tests/offers/visibility.test.ts`: `GET /member/offers/:id` returns 200 for a published, currently valid offer with explicit fields and no `organisation` contract columns (`legal_name`, `fee_tier`). It returns 404 with an identical body and headers for draft, pending, withdrawn, future, expired and unknown ids. An applicant, an organisation user and an anonymous caller are refused
- [X] T046 [P] [US2] `server/tests/push/payload.test.ts`: the dispatcher's message `data` is `{v:'1', nid, type, id}` with every value a string, and the title and body match the device locale. The counter-assertion checks that a `de` device doesn't get the English text
- [X] T047 [P] [US2] Export `DESTINATION_ROUTES` (a `Record<DestinationType, { pathname: string; param: 'id' | 'slug' } | null>`, plain data) and `resolveDestination(data: Record<string,string>)` from `packages/contracts/src/push.ts`, and test them with the contracts package's existing vitest in `packages/contracts/src/push.test.ts` (analysis U2: the Expo workspace has no test runner):
  - each `DESTINATION_TYPES` entry resolves as in contracts/push-payload.md
  - unknown type, `none`, `article`, a missing `id`, and `v !== '1'` resolve to `null`
  - counter-assertion: `offer` with an id resolves to the offer path, not `null`

### Implementation for User Story 2

- [X] T048 [P] [US2] Create `server/src/modules/offers/application/offer.ts` with `getMemberOffer(app, { id, signal })`: explicit columns, join `organisation_profiles` (display name, logo) and `organisations.slug` only, `state='published' AND now() BETWEEN valid_from AND valid_until`, logo as a derivative `ImageRef`, and 404 otherwise
- [X] T049 [US2] Create `server/src/modules/offers/routes.ts` and `controller.ts` for `GET /member/offers/:id` (`auth: { audience: 'member' }`, budget `member-read`, bucket `member-api`, `onRequest: app.guard`). Register it in `server/src/app.ts` next to the other module routes, and add it to `server/tests/authz/matrix.test.ts`
- [X] T050 [P] [US2] Add `offers.detail(id)` and `marketplace.listing(id)` (if missing) to `expo-client/german-world-club/src/api/endpoints.ts`
- [X] T051 [US2] Create `expo-client/german-world-club/src/notifications/routes.ts`, a thin adapter that turns `resolveDestination()` from `@gwc/contracts/push` into an expo-router `Href`. It contains no mapping logic of its own, so the tested table in contracts is the only copy (depends on T047). The `Record<DestinationType, …>` type makes an unmapped new type a compile error
- [X] T052 [US2] Create `expo-client/german-world-club/src/notifications/notification-router.tsx` (research R10):
  - `useLastNotificationResponse()` for a cold start and `addNotificationResponseReceivedListener` for warm taps
  - deduplicate on `data.nid` / `request.identifier`
  - wait while the session is `loading`
  - hold the destination in a ref while the state isn't `member` and replay it on the transition
  - `router.push(toHref(resolveDestination(data)))`
- [X] T053 [US2] Mount `<NotificationRouter />` in `expo-client/german-world-club/src/app/_layout.tsx` inside `SessionProvider`, rendered alongside `RootStack` so it survives group switches
- [X] T054 [P] [US2] Create `expo-client/german-world-club/src/app/(member)/activity/offer/[id].tsx`: title, merchant name and logo (linking to `threads/organisation/[slug]`), benefit, prices through `formatMoney`, validity through `formatDate`, conditions. A 404 renders the existing "not available" state used by `events/[id].tsx`
- [X] T055 [P] [US2] Create `expo-client/german-world-club/src/app/(member)/activity/listing/[id].tsx`: a read-only listing view (title, photos through `media-carousel`, price, description) from `GET /marketplace/listings/:id`. A 404 renders "not available". No edit or contact actions in this feature
- [X] T056 [US2] Register the `offer/[id]` and `listing/[id]` screens in `expo-client/german-world-club/src/app/(member)/activity/_layout.tsx`
- [X] T057 [P] [US2] Add `offer.*`, `listing.*` and `notAvailable` strings (if not already shared) to `expo-client/german-world-club/src/i18n/en.ts` and `de.ts`

**Checkpoint**: US1 and US2 together are the mobile MVP. A hand-queued notification arrives and opens the right screen from every app state.

---

## Phase 5: User Story 3 - Staff rehearse on test users, then broadcast to everyone (Priority: P2)

**Goal**: A console Push section with test users, bilingual compose, an audience confirm, and queued, idempotent sends with live history.

**Independent Test**: Add one test user, rehearse (only that phone receives it), broadcast (every enabled member device), and confirm the history totals. quickstart rows 4–8.

### Tests for User Story 3

- [X] T058 [P] [US3] `server/tests/push/campaigns.test.ts`:
  - rehearsal returns 202 and reaches only test users' devices (counter-assertion: a non-test member's device gets nothing, and the test device gets it)
  - broadcast reaches every eligible device
  - the same `clientRef` with the same content gives one row, a 200 on the second call with the same id, and one audit entry
  - the same `clientRef` with **different** content gives 409 `push/idempotency-conflict`, no second row and no second audit entry (counter-assertion: a fresh `clientRef` with that content gives 202 and a new row)
  - an empty test list gives 409 `push/no-test-recipients` and no row
  - DE and EN are both required, and the length limits are enforced
- [X] T059 [P] [US3] `server/tests/push/test-recipients.test.ts`:
  - add and remove write `push_test_recipient_added` / `_removed` audit entries naming the actor
  - removing an absent member gives 404
  - the `GET /push/test-recipients` response contains no `email` key and no `@` anywhere in the body (counter-assertion: the seeded test member's `handle` and `deviceCount` are present)
- [X] T060 [P] [US3] `server/tests/push/audience-endpoint.test.ts`: `GET /push/audience?kind=broadcast` matches the number of deliveries a following broadcast materialises
- [X] T061 [P] [US3] Add the staff routes (`GET /push/audience`, `GET /push/campaigns/:id`, and the changed campaign routes) to `server/tests/authz/matrix.test.ts`. Staff without `mass_messages` are refused, and a superadmin is allowed

### Implementation for User Story 3

- [X] T062 [US3] In `server/src/modules/push/routes.ts` and `controller.ts`:
  - `POST /push/campaigns` and `/preview` call `enqueueNotification` (kind `broadcast`/`rehearsal`, audience `broadcasts`/`test`) and return 202, or 200 when not `created`. Their budget changes to `admin-read`
  - a rehearsal with an empty test list raises `push/no-test-recipients`
  - add `GET /push/audience` (flag `read`) and `GET /push/campaigns/:id` (flag `read`)
  - `GET /push/campaigns` accepts `kind` (keeping `isTest` for one release) and returns `notificationListSchema`
- [X] T063 [US3] In `server/src/modules/push/application/test-recipients.ts`:
  - write audit entries on add and remove (actor, target member, `requiredPermission: 'mass_messages.edit'`)
  - **stop returning `email`** (constitution VI, analysis A2). `listTestRecipients` selects `t.member_id, m.display_name, m.handle, device_count` only, ordered by `m.display_name NULLS LAST, m.handle`, and maps to `{ memberId, displayName, handle, deviceCount }`
  - change `testRecipientListSchema` in `packages/contracts/src/push.ts` to match: no `email`, add `handle: string | null`
  - comment why: a rehearsal list needs to tell staff *who*, not how to contact them, and the console adds people by handle anyway
  - *Also added:* `POST /push/test-recipients` accepts `{ handle }` as well as `{ memberId }`. `GET /admin/members/by-handle` needs `members.read`, which the seeded push-staff role doesn't hold, so the console adds by handle through the push route under `mass_messages.edit` instead.
- [X] T064 [P] [US3] Add the push endpoints (test recipients, audience, campaigns list, get, send and preview) to `client/src/lib/api.ts`, typed from `@gwc/contracts/push`
- [X] T065 [US3] Create `client/src/console/admin/Push.tsx` (research R14) with tabs:
  - **Test users**: handle lookup through `GET /admin/members/by-handle/:handle`, the same pattern as `Influencers.tsx`, with add, remove and device count
  - **Compose**: DE and EN title and body with live counters (65/240), an optional destination type and id and label, **Send rehearsal**, and **Broadcast**. Broadcast fetches the audience and confirms "N members, M devices"; the button is disabled while a request is in flight
  - `clientRef` is generated when the form mounts **and again after every accepted send** (a 200 or 202 response). It's kept across a network error, so a retry of the same message is deduplicated. A `push/idempotency-conflict` response makes a new ref and asks the user to send again (analysis U1)
  - **History**: kind and status badges and totals, polling every 5 s while any entry is `queued`/`sending`
  - problems are translated on `type`
- [X] T066 [US3] Replace `NotBuilt` for `/konsole/admin/push` with `Push` behind `RequireGrant module="mass_messages"` in `client/src/console/routes.tsx`. Confirm the sidebar entry in `client/src/console/admin/AdminLayout.tsx` still points there
- [X] T067 [P] [US3] Add `push.*` console strings to `client/src/i18n/en.ts` and `de.ts` (the same keys, including the `push/no-test-recipients` problem message). Money and dates are formatted per locale
- [X] T068 [P] [US3] Add a console test `client/src/console/admin/Push.test.tsx`:
  - Broadcast shows the audience confirm before any send request
  - a double click sends one request
  - the empty-test-list problem renders the translated message
  - two successive sends with different text carry **different** `clientRef`s, while a retry after a network error reuses the same one
  - *Location:* `client/tests/console/push.test.tsx`, next to the other console suites and their helpers.

**Checkpoint**: Staff can run quickstart rows 4–8 end to end.

---

## Phase 6: User Story 4 - Members hear about a newly published offer (Priority: P2)

**Goal**: An offer's transition to `published` queues exactly one notification. It's held until `valid_from`, cancelled if the offer is withdrawn, and filtered by the offers preference.

**Independent Test**: Publish a draft offer by SQL. One `kind='offer'` notification arrives and opens the offer. Republishing sends nothing. quickstart rows 9–12.

### Tests for User Story 4

- [X] T069 [P] [US4] `server/tests/push/offer-trigger.test.ts`:
  - `draft → published` inserts one notification with `not_before = greatest(now(), valid_from)` (counter-assertion: `draft → pending` inserts none)
  - `published → withdrawn → published` still gives one row
  - the transaction rolling back leaves no row
  - `gwc.suppress_offer_push='on'` inserts none
- [X] T070 [P] [US4] `server/tests/push/offer-dispatch.test.ts`:
  - a future `valid_from` isn't sent before its time
  - withdrawing before dispatch gives `cancelled` and no transport call
  - the rendered DE and EN titles use the merchant's `organisation_profiles.display_name` and truncate at 65
  - a member with `offers=false` is `skipped` or excluded while a broadcast still reaches them
- [X] T071 [P] [US4] Extend `server/tests/seed/` (for example `no-live-credentials.test.ts`, or a new `no-offer-push.test.ts`): after `seed:demo`, `SELECT count(*) FROM push_notifications WHERE kind='offer'` is 0 and published offers exist (counter-assertion)

### Implementation for User Story 4

- [X] T072 [US4] Create **`server/migrations/029_offer_push_trigger.sql`** (its own file, not an edit to 028: the runner applies each filename once, so a database that already ran 028 would never get a trigger added to it later; analysis U3) with the `offers_queue_push` trigger function and trigger (`AFTER INSERT OR UPDATE OF state ON offers`) per research R12. Use `CREATE OR REPLACE FUNCTION` and `DROP TRIGGER IF EXISTS … ; CREATE TRIGGER …` so it's safe to rerun. It uses `ON CONFLICT (idempotency_key) DO NOTHING`, honours `current_setting('gwc.suppress_offer_push', true)`, and has a comment explaining why it's a trigger and not a route hook
- [X] T073 [US4] In `server/src/seed/offers.ts`, run offer inserts in a transaction that first does `SET LOCAL gwc.suppress_offer_push = 'on'`, with a comment saying why: seeded history must not notify, which is the consistent-history rule
- [X] T074 [US4] Offer notifications are delivered by the `push.deliver` tick alone, because the trigger can't reach pg-boss. Confirm in `server/src/modules/push/application/dispatch.ts` that the sweep query includes `kind='offer'` rows with `not_before <= now()`, and record in a comment that offer latency is ≤ 1 minute by design and that the same job flag stops them (analysis D1)

**Checkpoint**: All four stories work independently.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T075 [P] Update `CLAUDE.md`: replace "No `notifications` table until real-time transport exists" and the related Threads/messaging lines per research R15. Add a short **Push notifications (feature 011)** entry: the outbox, `ELIGIBLE_DEVICE` as the single rule, the offer trigger and seed suppression, the app registering Expo tokens only, and the FCM key living in EAS and never in the repo
- [X] T076 [P] Update `server/README.md` deployment preconditions with `EXPO_ACCESS_TOKEN` (required in production, with enhanced push security enabled on the Expo project) and the FCM all-or-none rule
- [X] T077 [P] Update the comment block in `server/src/modules/push/routes.ts` listing routes and postures, and mark the obsolete parts of `PUSH-NOTIFICATION-BLUEPRINT.md` with a pointer to `specs/011-push-notifications/`
- [X] T078 [P] Add `push_notifications`, `push_deliveries` and `member_push_preferences` to `server/src/seed/tables.ts` as **not seeded** (deliveries imply sends that never happened, so the consistent-history rule applies), and check the manifest test still passes
- [X] T079 Create `server/src/scripts/bench-push.ts` and the `"bench:push": "node --env-file-if-exists=.env src/scripts/bench-push.ts"` script in `server/package.json`, following `bench-feed.ts` (analysis C1, SC-002):
  - development only (refuse under `NODE_ENV=production`, the same gate style as `seed:demo`)
  - expects `seed:perf` to have run, and registers one synthetic device per active member with a `bench:`-prefixed fake Expo token, tagged so it can be cleaned up
  - queues one broadcast through `enqueueNotification`, then drives `dispatchDue` with a stub transport (default 150 ms latency per batch, `--latency` flag) until the notification is final
  - prints devices, total duration, batches, and `count(*)` vs `count(DISTINCT device_id)` from `push_deliveries`
  - exits non-zero if the duration is over 10 min or any device has more than one delivery
  - deletes its synthetic devices and notification at the end, including after a failure
- [X] T080 Run `npm test` and `npm run -w client test:i18n`, `tsc --noEmit` in every workspace, and `npm run -w server verify:seo` (to confirm `/member/offers/*` isn't in the sitemap)
- [ ] T081 Run quickstart.md manual rows 1–16 on a development build (Android and iOS), and `npm run -w server bench:push` for SC-002. Record the results in `specs/011-push-notifications/quickstart.md` under a "Validation log" heading

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)**: none. T006 depends on T001, T002 and T004.
- **Foundational (2)**: depends on Setup only for the mobile half. The server half (T007–T027) can start immediately. **Blocks every story.**
  - T010 depends on T007 (enum values). T013 → T015 → T017 → T018/T019 → T020. T014 before T015 and T016.
- **US1 (3)** and **US2 (4)**: both P1, and both depend only on Phase 2. They can run in parallel, except that T053 and T043 both edit `_layout.tsx` (do them one after the other).
- **US3 (5)**: depends on Phase 2. It's independent of US1 and US2 on the server. Its manual test needs a registered device (US1).
- **US4 (6)**: depends on Phase 2, and on T048–T056 (US2) for the tap to open the offer. The server part (T069–T074) is independent.
- **Polish (7)**: after the chosen stories. T079 (bench) needs T015–T019; T081 runs last.

### Within each story

Tests first (they fail), then application code, then routes and controller, then client or mobile, then strings.

### Parallel opportunities

- Phase 2: T008, T009, T011 and T012 run in parallel with T007 → T010. All tests T021–T027 run in parallel once T015–T019 exist.
- US1: T028–T032 in parallel. T034, T037, T038 and T044 in parallel with T033.
- US2: T045–T047 in parallel. The server (T048–T049) and mobile (T050–T057) tracks in parallel.
- US3: T058–T061 in parallel. T064 and T067 in parallel with T062 and T063.
- US4: T069–T071 in parallel.

## Parallel Example: User Story 2

```bash
# Tests together:
Task: "T045 offers visibility suite in server/tests/offers/visibility.test.ts"
Task: "T046 payload suite in server/tests/push/payload.test.ts"
Task: "T047 DESTINATION_ROUTES + tests in packages/contracts/src/push.ts / push.test.ts"

# Then server and mobile tracks together (T051 after T047):
Task: "T048 getMemberOffer in server/src/modules/offers/application/offer.ts"
Task: "T051 Href adapter in expo-client/german-world-club/src/notifications/routes.ts"
Task: "T054 offer screen in expo-client/german-world-club/src/app/(member)/activity/offer/[id].tsx"
Task: "T055 listing screen in expo-client/german-world-club/src/app/(member)/activity/listing/[id].tsx"
```

## Implementation Strategy

### MVP first (US1 + US2, both P1)

1. Phase 1 Setup, then Phase 2 Foundational (the outbox is the core risk, so prove it with T021–T027 first).
2. US1: devices register and receive.
3. US2: taps open the right screen.
4. **Stop and validate** with quickstart rows 1–3, 5–6 and 13, using a notification queued by SQL insert or `POST /push/campaigns/preview` with a single test user added by SQL.

### Incremental delivery

5. US3: the console makes sending a staff task rather than a SQL one.
6. US4: offer notifications, which only matter once offers are published in practice.
7. Polish: `CLAUDE.md` rule change and docs, then the full quickstart.

## Notes

- **Don't** send from any request handler. If a test needs delivery, run the job (`app.runJob('push.deliver')`) or call `dispatchDue` directly.
- **Don't** copy the eligibility rule. Import `ELIGIBLE_DEVICE`.
- **Never** log, return or store a push token outside `push_devices.token` and `tokenPreview`.
- Commit after each task or logical group, on branch `011-push-notifications`.
