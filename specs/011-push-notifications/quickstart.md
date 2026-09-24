# Quickstart: validating Push Notifications (011)

Runnable checks that prove the feature end to end. Shapes are in [contracts/](contracts/), and tables in [data-model.md](data-model.md).

## Prerequisites

- PostgreSQL running, migrations applied: `npm run -w server migrate` (adds `028_push_outbox.sql` and `029_offer_push_trigger.sql`).
- `npm run -w server seed:dev && npm run -w server seed:demo`.
- **Server env** (`server/.env`):
  - `EXPO_ACCESS_TOKEN`: from expo.dev → account → Access tokens. With enhanced push security on, it's required in production. In development, leaving it unset turns on the logging transport (research R8).
  - FCM settings: leave all three unset. The app registers Expo tokens only.
- **Firebase / EAS (one-off)**:
  - FCM V1 service-account key uploaded in `eas credentials` → Android → *Google Service Account Key for Push Notifications (FCM V1)*. Rotate the key that was pasted into chat first.
  - `expo-client/german-world-club/google-services.json` downloaded from Firebase for package `com.germanworldclub.app`.
    - **TODO(owner), blocking Android builds (tasks T004, T006):** the file isn't in the repo yet. `app.json` already points `android.googleServicesFile` at it, so `npx expo prebuild` and every EAS Android build fail until it's added. Download it from Firebase → Project settings → *Your apps* → Android app `com.germanworldclub.app`, check that its `package_name` matches, and commit it. It's the client config, not a secret. Then run T006 (`npx expo prebuild --clean --platform android` and check that `com.google.gms.google-services` is applied).
    - The service-account key `expo-client/german-world-club/german-world-club-b103ddfadefe.json` is still on disk (git-ignored). Upload it to EAS if you haven't already, then delete it and rotate it (T005, research R8).
- **Mobile build**: `cd expo-client/german-world-club && npx expo install expo-notifications && npx expo prebuild --clean`, then `eas build --profile development --platform android` (or iOS). Expo Go can't receive remote pushes on Android.

## Automated suites

```bash
npm run -w server test -- tests/push          # outbox, idempotency, audience, receipts, offer trigger
npm run -w server test -- tests/ops           # no token in logs; no-server-localisation still green
npm run -w server test -- tests/seed          # seed:demo queues zero offer notifications
npm run -w client test && npm run -w client test:i18n
npm run -w expo-client/german-world-club typecheck
npm test
```

Expected: all green. Each push suite includes a counter-assertion, so it can't pass against a server that does nothing. For example, the broadcast test asserts that a device outside the audience received nothing **and** that one inside it did.

## Manual scenarios

| # | Do | Expect | Spec |
|---|---|---|---|
| 1 | Register as a new applicant in the dev build. Finish email verification but don't approve. | No permission prompt. `GET /push/devices` as that applicant → 403 onboarding problem. | US1-1, FR-001 |
| 2 | Approve the application in the console, then reopen the app. | Explanation sheet, then OS prompt. Accept. `push_devices` has one row with `locale` matching the app language. | US1-2 |
| 3 | Kill and relaunch the app. | No prompt. `last_seen_at` updated. | US1-3, FR-003 |
| 4 | Console → Push → Test users → add the member by handle. | Listed with 1 device. `audit_log` has `push_test_recipient_added`. | US3-2 |
| 5 | Compose DE+EN with destination `event` → **Send rehearsal**. | Response 202, status queued → done within 30 s. Only the test phone buzzes. | US3-3, SC-001 |
| 6 | Tap that notification with the app **fully closed**. | The app opens on the event. Back returns to the Events list. | US2-1, SC-003 |
| 7 | Switch the app to English. Rehearse again. | English text arrives. | US3-6 |
| 8 | Double-click **Broadcast** (or replay the request with the same `clientRef`). | One confirm showing member and device counts. One notification row. The second request returns 200 with the same id. | US3-4/5, FR-018 |
| 9 | `UPDATE offers SET state='published', published_at=now() WHERE id=…` on a draft offer with `valid_from` in the past. | One `kind='offer'` notification. The phone shows "Neues Angebot: <merchant>". Tapping opens the offer screen. | US4-1 |
| 10 | Withdraw and republish the same offer. | No second notification. | US4-2, FR-022 |
| 11 | Publish an offer with `valid_from` 5 min in the future. Withdraw it after 2 min. | Notification `cancelled`. Nothing sent. | US4-3/5 |
| 12 | Profile → Notifications → turn off *Offers*. Publish another offer. | Not received. A broadcast still arrives. | US4-4, FR-006 |
| 13 | Sign out in airplane mode, then go back online. | The device row is gone after the next sign-out sync. Server-side, `/auth/sign-out` deleted it by `session_id`. No further pushes. | US1-5, FR-005 |
| 14 | Uninstall the app. Broadcast twice, 20 min apart. | The first broadcast marks the device `unregistered` (ticket or receipt). The second has 0 failures for it. | SC-007 |
| 15 | Stop network egress to exp.host during a broadcast. | Deliveries stay `pending` and retry with backoff. The breaker opens. After recovery the notification ends `done`, or `partial` if 5 attempts ran out. Never duplicated. | Edge: provider outage |
| 16 | Start the server with `NODE_ENV=production` and no `EXPO_ACCESS_TOKEN`. | Refuses to boot with a message naming the variable. | FR-030 |

## Load check (SC-002)

```bash
npm run -w server seed:perf     # 5k members
npm run -w server bench:push    # optional: -- --latency 300
```

Expected: exit code 0, duration under 10 min (about 1 min at the default pacing of 100 per batch with a 1 s pause; the "≈ 8.5 min" in tasks.md T015 assumed about 600 a minute, which those constants don't produce), and `deliveries == distinct devices`. The script registers its own synthetic devices, stubs the transport, and removes everything it created (tasks T079).

## Validation log

**2026-09-24, implementation run (automated only).** PostgreSQL 17 (`pg17-ai`), Node 22.23.

| Check | Result |
|---|---|
| `server` vitest, full suite against `gwc_test` | 126 files, 1,543 passed, 1 skipped (the same skip as before this feature) |
| `server` push suites (`tests/push`), three runs back to back | 50/50 each run, no flakes |
| `packages/contracts` vitest (`resolveDestination`, offer template) | 18/18 |
| `client` vitest · `test:i18n` · `test:tokens` | 360/360 · catalogues agree · no stray colours |
| `tsc --noEmit`, all four workspaces | No new errors. `server` and `client` carry the same pre-existing errors as `HEAD` (server 1,201 lines at HEAD, 1,179 now; client 4). `expo-client` and `contracts` have none |
| Migrations 028/029 on a **copy** of the dev database at 027 (6 campaigns, 498 receipts, 120 devices) | Applied cleanly. Campaigns became finished broadcasts with English back-filled, receipts became `sent`, no device lost. Copy dropped |
| `seed:dev` + `seed:demo` on a scratch database | 35 published offers, **0** push notifications |
| `verify:seo` on that scratch database | 24 URLs, no problems. No `/member/offers/*` in the sitemap |
| `bench:push` (SC-002) on a scratch database after `seed:perf` | 5,000 devices, 50 batches, **58.2 s** (budget 600 s), 5,000 deliveries for 5,000 devices. Cleaned up after itself |
| `npx expo export --platform android` | Bundles |

**Not run yet — manual rows 1–16 on a device.** They need a development build (`eas build --profile development`), which is blocked on `google-services.json` (see Prerequisites, T004/T006). Run them once the file is in place and record the results here.
