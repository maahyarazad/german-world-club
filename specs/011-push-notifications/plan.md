# Implementation Plan: Push Notifications

**Branch**: `011-push-notifications` | **Date**: 2026-09-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/011-push-notifications/spec.md`

## Summary

Finish the push path that is half built. The server already stores devices, a test list and campaign history, and can talk to Expo and FCM. It sends inside the HTTP request, though, and nothing on the phone or in the console uses it.

This feature does four things:
1. It turns sending into a **persisted outbox**. A request queues, and a pg-boss kick plus a one-minute croner sweep deliver in paced, idempotent batches with retries, receipts and dead-token pruning.
2. It adds **offer notifications** through a database trigger on the offer's transition to `published`, with a minimal member offer endpoint and screen for the deep link.
3. It builds the **console Push section** (test users, bilingual compose with an audience confirm, and live history).
4. It builds the **mobile side** (`expo-notifications`, permission once onboarding is approved, token registration, foreground display, and a single `NotificationRouter` for deep links from cold start, background and foreground).

## Technical Context

**Language/Version**: Server: Node 22, TypeScript run through native type stripping (feature 007). Web client: React + Vite, TypeScript. Mobile: Expo SDK 57, React Native 0.86, React 19.2, TypeScript 6.

**Primary Dependencies**: Fastify 5, `pg`, `pg-boss` 12 (existing work queue), `croner` (existing scheduler), `undici` (existing push transport). Mobile adds **`expo-notifications` ~57** and uses the existing `expo-device`, `expo-constants`, `expo-router` and `expo-secure-store`. No `firebase-admin` or `expo-server-sdk` (see the existing rationale in `providers.ts`).

**Storage**: PostgreSQL. Migrations `028_push_outbox.sql` and `029_offer_push_trigger.sql`. 028 changes `push_devices`, renames and extends `push_campaigns` → `push_notifications` and `push_campaign_recipients` → `push_deliveries`, adds `member_push_preferences`, and adds a trigger on `offers`. See [data-model.md](data-model.md).

**Testing**: Vitest (`npm run -w server test`; the SQL suites skip loudly without a DB), the client's vitest and `test:i18n`, and `tsc --noEmit` across workspaces. New suite directory `server/tests/push/`.

**Target Platform**: Linux server; modern browsers for the console; iOS and Android through EAS development and production builds (not Expo Go).

**Project Type**: Web service, web client and mobile app in one npm-workspace monorepo, with shared `packages/contracts`.

**Performance Goals**: A rehearsal reaches the phone within 30 s (SC-001). A 5,000-device broadcast finishes within 10 min (SC-002). The request that queues a send stays within `admin-read` (5 s).

**Constraints**: Persist before notify. No provider call inside any request. Provider calls sit behind breakers with a declared fallback. Paced batches of ≤100 (Expo's limit). No tokens in logs or responses beyond `tokenPreview`. The server emits no localised *response* text.

**Scale/Scope**: About 5k members / devices (the `seed:perf` scale). 2 migrations, about 10 changed or new server routes, 2 new jobs, 1 console page, 3 new mobile screens or components (offer, listing, notification settings) plus `NotificationRouter`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | How this plan satisfies it | Automated check |
|---|---|---|
| **I. One Rule Set, Three Clients** | Destination types, the offer text template, request and response types, and the new problem type live in `@gwc/contracts/push` / `offers` / `errors`. Eligibility is decided server-side only (`ELIGIBLE_DEVICE`). The app's permission timing is display-only, and 10-auth refuses applicants anyway. | `tsc --noEmit` in all workspaces. `tests/push/audience.test.ts` covers the preference, onboarding and locked-member rules server-side. |
| **II. Declare Every Posture** | Every new route declares `config.auth`, and device routes deliberately omit `onboarding: true`. `/member/offers/:id` is member-gated JSON, not an indexed surface, so it needs no row in `seo/surfaces.ts`. It lives under `/member/` like events, for the same reason. | The existing boot gate plus the access-matrix suite extended with the new routes × every principal kind. |
| **III. Published State = Real State** | The offer endpoint returns 404 unless the offer is published and currently valid. An offer notification is cancelled if the offer is no longer published at dispatch, and held until `valid_from`. | `tests/push/offer-trigger.test.ts`, `tests/offers/visibility.test.ts` (404 for draft, withdrawn, future and expired). |
| **IV. Integrity in the DB** | "Once per offer" is `UNIQUE(idempotency_key)`. "Once per device" is `UNIQUE(notification_id, device_id)`. One member per token is `UNIQUE(token)`. The offer trigger commits with the publication. Final notification states are guarded by a trigger. The audit log stays append-only. | Concurrency test: two dispatchers against one notification → no duplicate deliveries. Retrying a request with the same `clientRef` → one row. |
| **V. Failure Explicit & Bounded** | `pushExpo` / `pushFcm` breakers with fallback `retry-later`. Business rejections (dead tokens) are excluded from tripping them. Paced batches. Campaign routes no longer carry outbound calls, so the budget gate holds. Both jobs are individually enableable, and runs are logged in `job_runs`. | `tests/resilience/` (induced provider failure: deliveries stay pending, breaker opens, no request fails). `assertBreakers` / `assertBudgets` at boot. |
| **VI. Server Shapes Output** | Deliveries no longer copy the token. The device response keeps `tokenPreview` only. The payload `data` has no member data. Every query in `application/` names its columns. The offer response carries the logo *derivative*, never the original. | Log-scan suite extended to push jobs (no `ExponentPushToken[` in logs). `tests/ops/no-select-star` covers the new modules. |
| **Tech baseline: persist before deliver** | Now true for push, where today it isn't. | `tests/push/persist-before-notify.test.ts`: transport stub asserts the notification row is committed before its first call, and that the request returns before any transport call. |
| **Tech baseline: secrets / boot checks** | `EXPO_ACCESS_TOKEN` is required in production. FCM variables are all or none. The service-account key is never in the repo or the app. | `tests/ops/env.test.ts` cases. |
| **Workflow: scheduled work auditable** | `push.deliver` and `push.receipts` are registered in `PLATFORM_JOBS`. | Existing jobs suite enumerates definitions. |

**Result: PASS**, with one justified deviation recorded under Complexity Tracking (server-assembled notification text).

**Post-design re-check (after Phase 1):** Still PASS. The design adds no route without posture, no provider call to any request budget, and no unbounded send. The one deviation is unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/011-push-notifications/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R15 decisions
├── data-model.md        # migration 028 shape, states, audience rule
├── quickstart.md        # validation scenarios
├── contracts/
│   ├── http-api.md      # member + staff routes
│   └── push-payload.md  # payload, destination types, deep-link rules
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks (not created here)
```

### Source Code (repository root)

```text
packages/contracts/src/
├── push.ts                       # CHANGED: DESTINATION_TYPES, bilingual campaign request,
│                                 #   Notification/status, preferences, audience, OFFER_PUSH_TEMPLATE
├── offers.ts                     # NEW: MemberOffer
└── errors.ts                     # CHANGED: push/no-test-recipients

server/
├── migrations/028_push_outbox.sql            # NEW
├── migrations/029_offer_push_trigger.sql     # NEW (US4; separate file so 028 stays immutable)
├── src/scripts/bench-push.ts                 # NEW: SC-002 load check (bench:push)
├── src/config/breakers.ts                    # CHANGED: pushExpo, pushFcm
├── src/config/env.ts                         # CHANGED: prod requires EXPO_ACCESS_TOKEN; FCM all-or-none
├── src/ops/jobs.ts                           # CHANGED: push.deliver, push.receipts
├── src/modules/push/
│   ├── routes.ts                             # CHANGED: new routes, budgets, schemas
│   ├── controller.ts                         # CHANGED
│   ├── providers.ts                          # CHANGED: ticket ids, dead-token classification, receipts
│   └── application/
│       ├── audience.ts                       # NEW: ELIGIBLE_DEVICE (single rule)
│       ├── enqueue.ts                        # NEW: queue staff notification + kick (replaces inline send)
│       ├── dispatch.ts                       # NEW: materialise, claim, send, finish
│       ├── receipts.ts                       # NEW
│       ├── preferences.ts                    # NEW
│       ├── campaign.ts                       # REMOVED (split into enqueue/dispatch)
│       ├── devices.ts                        # CHANGED: upsert on token, locale, session_id, PATCH
│       └── test-recipients.ts                # CHANGED: audit add/remove
├── src/modules/offers/                       # NEW: routes.ts, controller.ts, application/offer.ts
├── src/modules/auth/…sign-out                # CHANGED: delete devices by session_id
├── src/seed/offers.ts                        # CHANGED: SET LOCAL gwc.suppress_offer_push
└── tests/push/, tests/offers/                # NEW suites (+ ops/resilience/seed additions)

client/src/
├── console/admin/Push.tsx                    # NEW: tabs Test users / Compose / History
├── console/routes.tsx                        # CHANGED: /konsole/admin/push → Push (was NotBuilt)
├── lib/api (push endpoints)                  # CHANGED
└── i18n/{de,en}                              # CHANGED: push.* keys

expo-client/german-world-club/
├── app.json                                  # CHANGED: expo-notifications plugin, android.googleServicesFile
├── google-services.json                      # NEW (Firebase client config, committed; not a secret)
├── package.json                              # CHANGED: expo-notifications
└── src/
    ├── notifications/
    │   ├── setup.ts                          # NEW: handler, Android channel
    │   ├── registration.ts                   # NEW: ask-once, token, listener, register/deregister
    │   ├── routes.ts                         # NEW: Href adapter over resolveDestination() from contracts
    │   └── notification-router.tsx           # NEW: cold/warm taps, hold until member
    ├── app/_layout.tsx                       # CHANGED: mount NotificationRouter
    ├── app/(member)/activity/offer/[id].tsx  # NEW
    ├── app/(member)/activity/listing/[id].tsx# NEW (read-only)
    ├── app/(member)/profile/notifications.tsx# NEW: settings (offers / broadcasts / all)
    ├── session/session.tsx                   # CHANGED: deregister on signOut before forgetting
    ├── api/endpoints.ts                      # CHANGED: push + offers
    └── i18n/{de,en}.ts                       # CHANGED

CLAUDE.md                                     # CHANGED: the notifications-table rule (research R15)
```

**Structure Decision**: The existing monorepo layout. Server work stays in `modules/push/` split into routes, controller and application as in the other modules. The single visibility-style rule (`ELIGIBLE_DEVICE`) follows the `VISIBLE_POST` convention. Offers get their own module because a future merchant portal will grow it. The mobile push code is gathered in `src/notifications/` so the root layout only mounts one component.

## Delivery order (for /speckit-tasks)

1. **Foundation**: contracts, migration 028, env and breaker config (blocks everything).
2. **US1 (P1)**: device registration changes, preferences, sign-out cleanup, and mobile setup and registration. Also `app.json`, `google-services.json` and a prebuild check.
3. **Outbox**: enqueue, dispatch, the `push.deliver` job and receipts. This is the prerequisite for sending anything in US2 to US4.
4. **US2 (P1)**: payload, `NotificationRouter`, offer and listing screens, and `GET /member/offers/:id`.
5. **US3 (P2)**: staff route changes, audience endpoint, audit, and the console Push page.
6. **US4 (P2)**: offer trigger, seed suppression, cancellation at dispatch.
7. **Polish**: `CLAUDE.md` rule change, log-scan and resilience suites, the quickstart run-through.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The server assembles localised text for **offer** notifications from `OFFER_PUSH_TEMPLATE`, against the spirit of "the server emits no localised text" | The OS renders a push while the app isn't running, so the app can't translate it. Staff notifications avoid this because staff write both languages. Offer notifications have no author. | *Localisation keys* (APNs/FCM loc-keys): Expo's push service doesn't pass them through, and they would need native string resources in two platforms. *English only / German only*: breaks acceptance scenario 3.6 for half the membership. The template lives in `@gwc/contracts` rather than the server, and no HTTP response varies with `Accept-Language`, so `no-server-localisation.test` still holds as written. |
| Renaming `push_campaigns` / `push_campaign_recipients` in place | Each notification now has a kind, a status and per-device retry state. The old names describe only staff campaigns. | *New tables alongside*: two histories, and the console would have to merge them. The rename keeps the sends already recorded. |
