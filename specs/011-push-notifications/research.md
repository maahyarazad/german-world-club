# Research: Push Notifications (011)

Each entry records the decision, why it was made, and what else was considered. "Existing" means the code as it stands on `main` at 70472b9.

---

## R1. Delivery moves out of the request and into an outbox

**Decision.** `POST /push/campaigns` and `/push/campaigns/preview` insert a `push_notifications` row with status `queued` and return `202`. Delivery runs afterwards in two stages:

1. **Kick.** After the insert commits, the handler calls `app.boss.send('push.dispatch', {}, { singletonKey: 'push.dispatch' })` on the existing pg-boss instance (`modules/media/queue.ts`, exposed once as `app.boss`). The send is best-effort, and a failure is logged but doesn't fail the request. The worker's **only** action is `app.runJob('push.deliver')`. It never calls the dispatcher directly, so the job's `enabled` flag stops every send path, and every kick is written to `job_runs` (constitution: *scheduled work is auditable*; §11 lets staff stop a misbehaving job). *(Revised after /speckit-analyze D1. The first draft had the worker dispatch by id, which bypassed the flag.)*
2. **Sweep.** A new croner job, `push.deliver`, runs every minute and dispatches every notification that is due and not finished (`status IN ('queued','sending') AND not_before <= now()`), with a lease. So a lost kick, a crash partway through a send, or a `not_before` in the future is picked up within a minute. The job has no other role.

A dispatch first *materialises* the audience into `push_deliveries` with `INSERT … SELECT … ON CONFLICT (notification_id, device_id) DO NOTHING`. Then it claims `pending` rows in batches of 100 using `FOR UPDATE SKIP LOCKED` plus a lease (the same claim-then-send-outside-a-transaction pattern as `deliverDueMail`), sends them, and records each outcome. It paces itself: at most one Expo batch in flight and a fixed pause between batches (Principle V, bulk communication).

**Rationale.** Existing `dispatchCampaign` sends to every device inside the HTTP request under the `admin-report` budget (28 s), then writes the record. That breaks persist-before-notify (Technology Baseline), puts two outbound dependencies in a request whose budget doesn't name them (Principle V), and can't finish for 5,000 devices within the deadline (SC-002). The kick keeps SC-001 (30 s to a rehearsal) without a sub-minute cron, and the sweep gives the retry and crash-recovery guarantees the kick alone can't.

**Alternatives considered.**
- *Cron only, every 10 s.* Rejected: it writes a `job_runs` row per tick (8,640 a day) and still takes up to 10 s.
- *pg-boss only.* Rejected: a kick lost between commit and `send` would strand the notification. The sweep is what makes the kick safe to lose.
- *Enqueue the pg-boss job inside the transaction.* Rejected: pg-boss uses its own connection, so the job could run before the row is visible.

## R2. Idempotency: one notification per request, one delivery per device

**Decision.**
- Staff sends carry a `clientRef` (a uuid the console generates when the compose form opens **and again after every accepted send**) stored as `push_notifications.idempotency_key` with `UNIQUE`, next to a `payload_hash`. A repeat with the same content returns the existing row with `200`. A repeat with **different** content is `409 push/idempotency-conflict`, because silently answering with the earlier message would drop the new one. *(Revised after analysis U1.)*
- Offer notifications use `idempotency_key = 'offer:' || offer_id`, which enforces "announced at most once" (FR-022) in the database.
- `push_deliveries` is `UNIQUE (notification_id, device_id)`. **At most once per device.** Claiming a delivery moves it `pending → sending` in the same statement. Only an outcome that proves the provider did *not* accept the message (refusal, connection failure) returns it to `pending` for a retry. A row still in `sending` after the lease (the process died between the provider accepting it and the outcome being saved) becomes `failed` / `outcome unknown` and is never resent. In that rare case a member may miss one notification, which is preferred over their phone buzzing twice. SC-002 and FR-028 hold as written. *(Revised after analysis I1. The first draft allowed a duplicate send in that case.)*

**Rationale.** Principle IV: "Operations that may be retried MUST carry a deterministic reference."

## R3. Tokens belong to one member; sign-out removes the device

**Decision.** Migration `028` changes `UNIQUE (member_id, token)` to `UNIQUE (token)`. Registration becomes `ON CONFLICT (token) DO UPDATE SET member_id = EXCLUDED.member_id, …`, so the most recent sign-in on a phone owns it (FR-004, acceptance scenario 1.6). `push_devices.session_id` records the session that registered it. `POST /auth/sign-out` deletes devices whose `session_id` is the session being revoked, in the same transaction as the revocation. That covers FR-005 even when the app's own `DELETE /push/devices/:id` never arrives (offline sign-out).

**Not done.** Eligibility doesn't require a *live* session. The platform allows one session per account, so signing in on the web console would silence the member's phone. Devices end on explicit sign-out, on a dead token (R6), or when the 180-day prune job removes them.

## R4. Onboarding gate

**Decision.** Device routes keep `auth: { audience: 'member' }` and do **not** declare `onboarding: true`. 10-auth already refuses applicants whose application isn't approved on every route without that flag, so an applicant can't register a device even with a tampered client (FR-001 enforced server-side). The app asks only when `SessionState.status === 'member'`, which `session.tsx` sets only on `onboarding.step === 'approved'` or for members with no application. As a second safeguard, the audience query joins `membership_applications` the same way 10-auth does.

## R5. Language of the notification text

**Decision.**
- `push_devices.locale` (`'de' | 'en'`, default `'de'`) is sent with every registration from the app's `useTranslations().locale`, and again whenever the member changes language.
- Staff notifications store `title_de`, `body_de`, `title_en` and `body_en`, and every one of the four is required (FR-014).
- Offer notifications use a fixed template pair exported from `@gwc/contracts/push` (`OFFER_PUSH_TEMPLATE.de/.en`). The server fills it with the offer title and the merchant's `organisation_profiles.display_name`.

**Rationale and the rule this touches.** `CLAUDE.md` says "the server emits no localised text", and `tests/ops/no-server-localisation.test.js` asserts that no *response body* varies with `Accept-Language`. A push is rendered by the operating system while the app isn't running, so the app can't translate it. The text has to arrive already in the right language. That stays within the rule as tested, because no response varies, and the templates live in the shared contracts package rather than in the server. It is still new server-assembled prose, and it's recorded under Complexity Tracking.

**Alternatives considered.** Localisation keys in the payload (APNs `title-loc-key`, FCM `title_loc_key`) were rejected. Expo's push service doesn't pass them through, and they would need native string resources in two places.

## R6. Provider receipts and dead tokens

**Decision.**
- Expo returns a *ticket* per message. `DeviceNotRegistered` on a ticket disables the device straight away. Tickets that return `ok` store the ticket id in `push_deliveries.provider_ref`.
- A `push.receipts` croner job (every 15 minutes) fetches receipts for tickets older than 15 minutes and younger than 24 hours. It marks `failed` and disables the device on `DeviceNotRegistered`.
- For FCM, `UNREGISTERED` / HTTP 404 disables the device straight away (FR-027).

Transient failures (HTTP 429/5xx, network) leave the delivery `pending` with `attempts + 1` and `next_attempt_at` backed off, up to 5 attempts, then `failed`.

## R7. Circuit breakers and budgets

**Decision.** Add `pushExpo` and `pushFcm` to `config/breakers.ts`:
- timeout 10 s
- fallback `'retry-later'`: the outbox keeps the delivery `pending`
- `retrySafe: true`
- `why`: "a push that can't be delivered now can wait; nothing is lost"

Neither appears in any route's `calls`, because no route calls a provider any more, so the `Σ budgets < deadline` gate is untouched. The campaign routes drop from `admin-report` to `admin-read`.

Provider errors that are *business* rejections (`DeviceNotRegistered`, `InvalidCredentials` on one token) don't count towards the breaker (Principle V, `errorFilter`).

## R8. Credentials and environment

**Decision.**
- Production: boot is refused without `EXPO_ACCESS_TOKEN`. The Expo project enables *enhanced push security*, so a leaked Expo token can't be used by someone else to push to members.
- FCM settings (`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`) are all set or all unset. A partial set refuses boot in every environment.
- Development with no credentials: the transport is replaced by a logging transport that records "would send" per device and marks deliveries `sent`. This is the same bargain as queued mail in development.
- The app registers **Expo tokens only** (`provider: 'expo'`). The existing direct-FCM path stays for any `fcm` rows, but the app never produces one. Android delivery reaches FCM through Expo, which uses the FCM V1 service account uploaded to EAS.
- The service-account JSON never enters the repository or the app. It is already git-ignored under `server/` and `expo-client/german-world-club/`. The copy inside the Expo project folder should be deleted, and the key rotated because it was pasted into a chat.

## R9. Mobile: permission, token and channel

Checked against the Expo SDK 57 `expo-notifications` docs:
- **Plugin.** `"expo-notifications"` goes in `app.json` plugins with `icon`, `color` and `defaultChannel: "default"`. `android.googleServicesFile: "./google-services.json"` points at the Firebase **client** config for `com.germanworldclub.app`, which is committed because it isn't a secret. `android/` is ignored (CNG), so `npx expo prebuild --clean` or an EAS build applies the Google Services Gradle plugin.
- **Channel.** `setNotificationChannelAsync('default', …)` runs before the permission request on Android. It's required for the prompt to appear on Android 13 and later.
- **Asking.** The app asks once. The first time a signed-in `member` state is reached, it shows an in-app explanation sheet, then calls `requestPermissionsAsync()`. The "asked" flag is stored in secure storage. After that, the only route back is the Profile → Notifications setting. If `canAskAgain` is false, it opens the system settings (FR-002).
- **Token.** `getExpoPushTokenAsync({ projectId: Constants.expoConfig.extra.eas.projectId })`. Registration happens on grant, on every cold start while the member is signed in, and from `addPushTokenListener` when the token rotates.
- **Foreground display.** `setNotificationHandler` returns `shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false` (FR-007). The in-app banner is the OS banner, so no extra component is needed.
- **Expo Go.** Remote push doesn't work in Expo Go on Android. Testing needs a development build (`eas build --profile development`).

## R10. Mobile: deep links and cold start

**Decision.** One component, `NotificationRouter`, is mounted inside `SessionProvider` in `src/app/_layout.tsx`.
- `useLastNotificationResponse()` covers a cold start, and `addNotificationResponseReceivedListener` covers foreground and background. Both feed one handler, deduplicated by `notification.request.identifier`.
- The handler passes `data` to `resolveDestination()` from `@gwc/contracts/push`, where `DESTINATION_ROUTES` is plain data tested with the contracts package's vitest. `src/notifications/routes.ts` only turns the result into an expo-router `Href`. The mapping lives in contracts because the Expo workspace has no test runner, and one tested table is better than an untested copy in the app. *(Revised after analysis U2.)*
- If the session isn't `member`, the destination is kept in a ref and replayed when the state becomes `member` (FR-011). A cold-start tap waits for `state.status !== 'loading'`.
- Navigation uses `router.push` onto the owning tab's stack, so Back returns to that tab's root (FR-009).
- An unknown type, or a type with no screen, maps to `null`, and the app stays on the home tab (FR-010).

| Destination | Route | Screen |
|---|---|---|
| `offer` | `/(member)/activity/offer/[id]` | **new**, minimal (R11) |
| `listing` | `/(member)/activity/listing/[id]` | **new**, read-only, uses existing `GET /marketplace/listings/:id` |
| `thread_post` | `/(member)/threads/[id]` | existing |
| `event` | `/(member)/events/[id]` | existing |
| `partner` | `/(member)/threads/organisation/[slug]` | existing. The destination id is the organisation **slug** |
| `article`, `none` | none | stays on home. No article screen exists on mobile |

Offers and listings go in the Activity stack because that's where a member looks for "things that happened to me". Native tabs can't hold screens that aren't tabs, so a new tab only for detail screens would be wrong.

## R11. Minimal offer read endpoint

**Decision.** New module `server/src/modules/offers/` with a single route, `GET /member/offers/:id`, declaring `auth: { audience: 'member' }`, `budget: 'member-read'` and `rateLimit: member-api`.
- It returns an offer only when `state = 'published' AND now() BETWEEN valid_from AND valid_until`. Anything else is the standard not-found problem, indistinguishable from an absent id. That covers acceptance scenario 2.3 and Principle III.
- Columns are named explicitly (the `SELECT *` convention): title, description, benefit kind and value, regular and member price, currency, validity, conditions, the merchant's `organisation_profiles.display_name`, slug and logo derivative.
- There is no list endpoint and no publishing route (spec, scope decision A).

## R12. Offer trigger lives in the database

**Decision.** An `AFTER INSERT OR UPDATE OF state ON offers` trigger. When `NEW.state = 'published'` and the old state wasn't, it inserts:

`push_notifications (kind='offer', offer_id, idempotency_key='offer:'||id, not_before=greatest(now(), valid_from), status='queued', audience='offers')` `ON CONFLICT (idempotency_key) DO NOTHING`.

The row commits or rolls back with the publication, and nothing is sent inside it (FR-021). Whether the publication came from the seed, a psql session, or the future merchant portal, the notification follows. The dispatcher re-checks `state = 'published'` and validity before sending, and marks the notification `cancelled` if not (FR-023, acceptance scenario 4.5). Text is built at dispatch time, so an offer renamed between publication and `valid_from` goes out under its current name.

**Seed.** The demo seed inserts offers already `published`, which would queue about 50 notifications on every fresh `seed:demo`. The seeder sets the session variable `SET LOCAL gwc.suppress_offer_push = 'on'`, and the trigger checks it, so seeded history doesn't notify anyone. `tests/seed/` asserts that zero offer notifications exist after a run.

## R13. Preferences

**Decision.** New table `member_push_preferences (member_id PK, offers boolean, broadcasts boolean, updated_at)`. No row means both on. `GET/PUT /push/preferences` (member). The audience query filters on it, so the server enforces it (FR-006). "All off" is the device's `enabled = false`, which `PUT /push/devices/current` sets, or the OS permission itself. Rehearsals ignore preferences, because test users agreed to be rehearsed on.

## R14. Console

**Decision.** `client/src/console/admin/Push.tsx` at `/konsole/admin/push`, behind `RequireGrant module="mass_messages"`, with three tabs:
- **Test users.** Add by handle through the existing `GET /admin/members/by-handle/:handle`, the same pattern as `Influencers.tsx`. The list shows the device count.
- **Compose.** German and English title and body with live character counts, an optional destination (type plus id), a **Send rehearsal** button, and a **Broadcast** button. Broadcast first calls `GET /push/audience?kind=broadcast` and shows "N members, M devices" in a confirm dialog (FR-016).
- **History.** Polls every 5 s while any entry is `queued` or `sending`.

All strings go in `client/src/i18n/{de,en}`, and `test:i18n` covers them.

## R15. `CLAUDE.md` rule change

**Decision.** This feature replaces the sentence "No `notifications` table until real-time transport exists" (and the related Threads note), because push is that transport. The new text says that pushes are persisted per notification and per device, that Activity is still computed on read, and that `delivered_at`/`read_at` on *messages* still wait for in-app real-time transport. Push delivery records aren't message read receipts.
