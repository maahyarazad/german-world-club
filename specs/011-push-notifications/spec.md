# Feature Specification: Push Notifications

**Feature Branch**: `011-push-notifications`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Push notifications for the mobile app: register once onboarding is finished; display notifications and deep-link into the app, including from a cold start; broadcast automatically when an offer is published; a superadmin Push Notifications section in the web console with test users and mass broadcast."

## Context: what already exists

This feature finishes work that is partly built. Planning should extend the existing code, not start again:

- **Server**: `server/src/modules/push/` already registers devices, sends campaigns and previews, lists campaign history, and manages a test-recipient list. It sends to both Expo and FCM (`providers.ts`), and the shared shapes are in `@gwc/contracts/push`. Tables come from migration `011_push_devices_and_campaigns.sql`. Staff routes are gated on the `mass_messages` permission module.
- **Known gap in the server**: `dispatchCampaign` sends **inside the HTTP request** and records the campaign afterwards. The platform's rule is persist-before-notify with retried delivery (the `mail_outbox` pattern). This feature replaces the inline send.
- **Web console**: the sidebar already links to `/konsole/admin/push`, but that route renders `NotBuilt`.
- **Mobile app**: nothing yet. `expo-notifications` is not installed, `app.json` has no `googleServicesFile`, and the Activity screen says it polls because "there is no push".
- **Offers**: the `offers` table and its states (`draft → pending → published | rejected | withdrawn`) exist, but only the demo seed writes to them. No route publishes an offer, and the mobile app has no offer screen.
- **Deep-link targets** are currently limited to `event | partner | article | none`.

**Change to a standing rule.** `CLAUDE.md` says there will be no `notifications` table and no delivery tracking "until real-time transport exists". Push is that transport. From this feature on, the platform keeps a persisted record of each notification and its delivery, and `CLAUDE.md` must be updated to say so. The in-app *Activity* feed is still computed when it is read. Push is an additional channel alongside it, not a replacement.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An approved member receives notifications on their phone (Priority: P1)

A member finishes onboarding and their application is approved. The next time the app is in front of them, it explains that the club sends notifications and asks for permission. If they allow it, their phone is registered to them. When the club sends something, it appears on the lock screen. If the app is open, it appears as a banner inside the app.

**Why this priority**: Without a registered device, every other story sends to nobody.

**Independent Test**: Approve a test applicant, open the app on a real device, and accept the prompt. The member's device list shows one enabled device. A test push from the console arrives on that phone.

**Acceptance Scenarios**:

1. **Given** an applicant whose application is not yet approved, **When** they use the app, **Then** they are never asked for notification permission and no device is registered for them.
2. **Given** a member whose application has just been approved, **When** they next open the app while signed in, **Then** they are asked for permission once, and accepting registers this device to them.
3. **Given** a member who declined permission, **When** they open the app again, **Then** they are not asked again automatically. The option to turn notifications on stays available in their profile settings and leads to the system settings.
4. **Given** a registered device whose push token changes (reinstall, OS token rotation), **When** the app next starts, **Then** the server holds the new token and the old one no longer receives anything.
5. **Given** a signed-in member with a registered device, **When** they sign out, **Then** that device is deregistered before the session ends and receives no further member notifications.
6. **Given** a phone previously registered to member A, **When** member B signs in on it, **Then** notifications meant for A no longer reach that phone.
7. **Given** the app is in the foreground, **When** a notification arrives, **Then** it is shown inside the app and does not interrupt what the member is doing.

---

### User Story 2 - Tapping a notification opens the right screen (Priority: P1)

A member taps a notification about an offer, a marketplace listing, a thread, an event or a partner. The app opens that item directly. This works whether the app was in the foreground, in the background, or fully closed.

**Why this priority**: A notification that opens the home screen makes the member search for the item, and most won't.

**Independent Test**: Send a test push with each destination type to a device where the app is closed. Tapping each one opens the matching detail screen.

**Acceptance Scenarios**:

1. **Given** the app is fully closed, **When** the member taps a notification pointing to an item, **Then** the app starts and shows that item, with a working back button to the member's home.
2. **Given** the app is in the background or foreground, **When** the member taps a notification, **Then** the app navigates to the item.
3. **Given** a notification pointing to an item that is no longer visible to the member (withdrawn offer, hidden listing, removed post), **When** they tap it, **Then** they see the same "not available" state the app shows for any absent item, and nothing of the item is revealed.
4. **Given** a member who has signed out, **When** a tap on an older notification opens the app, **Then** they are asked to sign in first and then taken to the item. If they can't see it, they get the "not available" state.
5. **Given** a notification whose destination this version of the app doesn't recognise, **When** it is tapped, **Then** the app opens its home screen and doesn't crash.

---

### User Story 3 - Staff rehearse on test users, then broadcast to everyone (Priority: P2)

In the console's Push Notifications section, a superadmin keeps a list of test users. These are named members whose phones receive rehearsals. The superadmin writes a notification in German and English, can pick a destination to link to, and sends it to the test users first. When it looks right on a real phone, they send the same message to the whole membership. They can then see how many deliveries succeeded or failed.

**Why this priority**: A club-wide broadcast can't be taken back. Rehearsing on test users is the only way to catch a typo or a broken link before every member sees it.

**Independent Test**: Add one test user. Send a rehearsal and confirm only that user's device receives it. Then broadcast and confirm every enabled member device receives it and the history shows the totals.

**Acceptance Scenarios**:

1. **Given** a staff user without the `mass_messages` permission, **When** they open the section or call any of its endpoints, **Then** they are refused, and the section is not shown in their sidebar.
2. **Given** a superadmin, **When** they add or remove a test user, **Then** the list updates and the change is written to the audit log with who made it.
3. **Given** a composed message, **When** the superadmin sends a rehearsal, **Then** only test users' enabled devices receive it, and the history marks it as a rehearsal.
4. **Given** a composed message, **When** the superadmin broadcasts, **Then** the console first confirms how many members and devices will be reached. Once confirmed, the broadcast is accepted immediately and delivered in the background. Its history entry moves from *queued* to *sending* to *done*, with success and failure counts.
5. **Given** a broadcast in progress, **When** the superadmin clicks send again or the request is retried, **Then** no second broadcast is created.
6. **Given** a member whose app is set to English, **When** a broadcast arrives, **Then** they see the English text. A member set to German sees the German text.
7. **Given** the list of test users is empty, **When** the superadmin tries to send a rehearsal, **Then** they are told there are no test users and nothing is sent.

---

### User Story 4 - Members hear about a newly published offer (Priority: P2)

When a merchant offer is published, members who have notifications on get a push about it. Tapping it opens the offer.

**Why this priority**: Visibility for partners is a paid deliverable. A new offer that nobody hears about is worth less to the merchant who paid for it.

**Independent Test**: Publish an offer. Every opted-in member device receives one notification naming the offer and the merchant, and tapping it opens the offer.

**Acceptance Scenarios**:

1. **Given** an offer that becomes *published*, **When** the publication is committed, **Then** one offer broadcast is queued. It is sent only after the publication is saved and never as part of saving it.
2. **Given** an offer that is withdrawn and published again, or a publication that is retried, **When** it is published again, **Then** members are not notified a second time about the same offer.
3. **Given** an offer that is published with a `valid_from` in the future, **When** it is published, **Then** the notification is held until `valid_from`. Members are never told about an offer they can't use yet.
4. **Given** a member who has turned off offer notifications, **When** an offer is published, **Then** they don't receive it, but they still receive club broadcasts.
5. **Given** an offer that was withdrawn before its queued notification went out, **When** the send runs, **Then** nothing is sent.

**Scope (decided 2026-09-24):** This feature builds the trigger on an offer's transition to *published*, wherever that transition comes from, and a minimal offer detail screen in the app for the notification to open. It does **not** build a way to publish offers. Until a merchant portal feature ships, only the seed and direct state changes publish offers, and that is how this story is tested. The trigger watches the state transition, not a particular route, so the future portal gets notifications without changing anything here.

---

### Edge Cases

- **Dead tokens**: If a provider reports a token as permanently invalid (the app was uninstalled), that device is disabled automatically so later broadcasts don't keep failing on it.
- **Provider outage**: If Expo or FCM is unreachable, delivery is retried with backoff. The broadcast ends as *partially failed* with counts, not *done*. A broadcast is never sent twice to the same device.
- **Large audiences**: Sending is paced in batches (Principle V), so a 5,000-member broadcast doesn't trip provider rate limits.
- **Member status changes mid-broadcast**: A member who is locked, suspended or ended before their batch goes out doesn't receive it.
- **Credentials missing** (no Expo access token or FCM key configured): In production the server refuses to start. In development, sends are logged instead of delivered, the same way queued mail is logged.
- **Organisation users** (merchant or partner logins) are not members. They register no devices and receive no member broadcasts.
- **Emoji and non-Latin text** in titles and bodies are stored and delivered intact.
- **Content length**: Titles and bodies longer than what lock screens display (title 65, body 240 characters per language) are rejected when composed, not truncated.
- **Contact details**: A notification's text is written by staff or built from public offer fields. It never includes another member's contact details or legal name.

## Requirements *(mandatory)*

### Functional Requirements

**Device registration (mobile)**

- **FR-001**: The app MUST request notification permission only for a signed-in member whose onboarding is complete (application approved, or no application row). It MUST never ask on first launch, on the public screens, or on the applicant screens.
- **FR-002**: The app MUST ask for permission at most once automatically. After that, turning notifications on is a setting the member chooses.
- **FR-003**: The app MUST register its push token with the server when it is granted, again whenever the token changes, and on each app start while the member is signed in (refreshing the device's last-seen time).
- **FR-004**: A device token MUST be registered to at most one member at a time. Registering a token that another member holds MUST move it to the new member.
- **FR-005**: Signing out MUST deregister the current device before the credentials are discarded. If that fails, the server MUST still stop sending to that device once its session is gone.
- **FR-006**: Members MUST be able to turn off offer notifications and club broadcasts separately, and to turn all notifications off. The server MUST enforce these choices, not only the app.
- **FR-007**: The app MUST show notifications while it is in the foreground (as an in-app banner) as well as in the background.

**Deep links (mobile)**

- **FR-008**: Every notification MUST carry a destination type and identifier. Supported destinations MUST include offer, marketplace listing, thread post, event, partner and none. The list of destinations MUST be defined once in the shared contracts package.
- **FR-009**: Tapping a notification MUST open that destination from foreground, background and a cold start, with navigation history that returns to the member's home.
- **FR-010**: A destination that is absent or not visible to the member MUST show the app's existing "not available" state. An unrecognised destination type MUST open the home screen.
- **FR-011**: A tap that arrives while the member is signed out MUST send them to sign in and then continue to the destination.

**Console: test users and broadcasts**

- **FR-012**: The console MUST provide a Push Notifications section at `/konsole/admin/push`, visible only to staff holding the `mass_messages` permission. Superadmins hold every permission and therefore see it.
- **FR-013**: Staff with `mass_messages` edit rights MUST be able to add members to the test-user list, remove them, and view it. Each change MUST be written to the audit log.
- **FR-014**: The compose form MUST require a title and a body in both German and English, within the length limits, and MUST allow an optional destination (type and item).
- **FR-015**: A rehearsal MUST reach only the enabled devices of test users. A broadcast MUST reach all enabled devices of active members who haven't opted out of club broadcasts.
- **FR-016**: Before a broadcast is sent, the console MUST show how many members and devices it will reach and require an explicit confirmation.
- **FR-017**: Sending a rehearsal or broadcast MUST save the notification first and return immediately. Delivery MUST happen afterwards, in the background, with paced batches and retries.
- **FR-018**: Every send MUST carry an idempotency reference, so a repeated request or a retried job cannot deliver the same notification to the same device twice.
- **FR-019**: The section MUST list past rehearsals and broadcasts with their status (queued, sending, done, partially failed, failed), who sent them, when, and success and failure counts.
- **FR-020**: Every rehearsal and broadcast MUST write an audit entry at the moment it is accepted, naming the staff member.

**Offer broadcasts**

- **FR-021**: An offer's transition to *published* MUST queue exactly one offer broadcast. It MUST be queued only once the publication commits, and never delivered inside that transaction.
- **FR-022**: An offer MUST be announced at most once, however many times it is published.
- **FR-023**: If an offer's `valid_from` is in the future, its broadcast MUST be held until `valid_from`. It MUST be cancelled if the offer is no longer published when it would be sent.
- **FR-024**: The text of an offer broadcast MUST be built from the offer's public fields and the merchant's public profile name, in both languages.
- **FR-025**: The offer broadcast MUST be triggered by the offer's state transition to *published*, whatever caused it. This feature MUST NOT add a merchant or staff route for publishing offers. The app MUST provide a minimal member-facing offer detail screen (title, merchant public name, benefit, validity, conditions), served by a member-only read endpoint that shows only currently published offers and answers not-found for anything else.

**Delivery and integrity (server)**

- **FR-026**: Delivery MUST use each device's declared provider and never send an Expo token to FCM or the reverse.
- **FR-027**: A token that a provider reports as permanently invalid MUST disable that device.
- **FR-028**: Every notification and each per-device delivery outcome MUST be persisted. A logging failure MUST NOT cause a delivered notification to be reported as unsent.
- **FR-029**: Push tokens MUST NOT appear in logs, error bodies or responses, apart from the truncated preview shown to the owning member.
- **FR-030**: In production, the server MUST refuse to start when push provider credentials are missing. FCM service-account credentials MUST NOT be shipped in the mobile app or committed to the repository.
- **FR-031**: Every new or changed route MUST declare its access posture. Member device routes MUST refuse applicants who are not approved.
- **FR-032**: The mobile build MUST include the notifications capability and the Android Firebase client configuration for package `com.germanworldclub.app`, so a clean prebuild or EAS build produces an app that can receive pushes.

### Key Entities

- **Push device**: a member's phone that can receive notifications. It has an owner, a provider (Expo or FCM), a platform, a token, an enabled flag, preferences (offers, club broadcasts), and a last-seen time. Each token belongs to at most one member.
- **Push notification** (was *campaign*): one thing sent. It has a kind (rehearsal, broadcast or offer), German and English text, a destination, who or what triggered it, an idempotency reference, a not-before time, a status, and totals.
- **Delivery**: one notification to one device. It has its outcome, the provider's error, and the number of attempts. It is unique per notification and device.
- **Test user**: a member on the rehearsal list, with who added them and when.
- **Offer**: already exists. This feature only reacts to its transition to *published*.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A member with notifications on receives a rehearsal on their phone within 30 seconds of the staff member pressing send.
- **SC-002**: A broadcast to 5,000 member devices finishes delivery within 10 minutes and never delivers twice to the same device, including when a batch is retried.
- **SC-003**: Tapping a notification opens the right item in 100% of tested cases for every destination type, from foreground, background and a closed app.
- **SC-004**: No applicant who hasn't been approved is ever asked for notification permission or receives a member broadcast.
- **SC-005**: A newly published offer reaches opted-in members exactly once.
- **SC-006**: A staff member can add a test user, rehearse, and broadcast in under 3 minutes without leaving the Push Notifications section.
- **SC-007**: After a provider reports a dead token, the next broadcast has no failures for that device.

## Assumptions

- "Superadmin only" maps to the existing `mass_messages` permission module. Superadmins hold it by definition, and other staff can be granted it deliberately. Adding a separate superadmin-only flag would duplicate the permission matrix.
- Language follows the member's app language setting, reported with the device registration. German is the default. The server stores both texts and doesn't translate anything, in line with the rule that the server produces no localised text.
- Expo's push service is the delivery path for this app, because it is built with Expo and FCM V1 credentials are already uploaded to EAS. The existing direct-FCM path stays for tokens registered as `fcm`.
- Test users are existing members chosen from a member search, not free-form device tokens.
- Notification preferences default to on for both categories once a member grants permission.
- Real-time in-app delivery (sockets), read receipts, notification scheduling by staff, and audience segmentation (for example by city or membership tier) are out of scope.
- Offer broadcasts go to the whole opted-in membership. They are not targeted by location.
