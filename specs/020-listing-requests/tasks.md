---

description: "Task list for feature 020: Send a request about a marketplace listing, with email updates"
---

# Tasks: Send a request about a marketplace listing, with email updates

**Input**: Design documents from `specs/020-listing-requests/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md,
contracts/http-and-ui.md, quickstart.md

**Tests**: Included. The constitution requires an automated check for every rule, and research
R11 names the suites. Each test carries a counter-assertion. Write each story's tests first and
watch them fail.

**Organization**: by user story from spec.md. All three are P1, and are ordered so each is
testable on its own: US1 sends, US2 emails, US3 reads and replies.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US3 from spec.md

## House rules every task inherits

- Server code is TypeScript under `server/src/`. HTTP features live in `modules/<domain>/` as
  `routes.ts` / `controller.ts` / `application/`. Queries on a response path **name their
  columns** (`tests/messaging/no-select-star.test.ts` checks it).
- **No email address or phone number** of either party in any response or email (FR-005,
  008 FR-026).
- A message is saved **before** anyone is notified. Notification runs after commit and never
  fails the request (`notifyAfterCommit`, which already exists).
- No new problem types. Errors are RFC 9457, and clients branch on `type`.
- Clients:
  - every string goes in both catalogues;
  - a caught error is `console.error('<Component>.<fn>', error instanceof ApiError ? error.problem : error)`;
  - the only refusals shown on screen are a closed listing and "slow down" (429).
- Server tests run against real Postgres:
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/gwc_test` (scratch database).

---

## Phase 1: Setup

**Purpose**: the shared message shapes every story imports (research R8)

- [X] T001 In `packages/contracts/src/messaging.ts`:
  - extend `ConversationSubject` with `title: string | null`;
  - add `Counterpart = { memberId: string; displayName: string | null; handle: string | null }`
    and `LastMessage = { senderId: string; excerpt: string; createdAt: string }`;
  - extend `Conversation` with `counterpart: Counterpart` and `lastMessage: LastMessage | null`;
  - add `InboxPage = { items: Conversation[]; nextCursor: string | null }` and
    `ConversationView = { conversation: Conversation; participants: Participant[]; messages: Message[]; nextCursor: string | null }`;
  - add zod schemas for each (`conversationSchema`, `inboxPageSchema`,
    `conversationViewSchema`, `messageSchema`, `sendMessageRequestSchema` with
    `body: z.string().trim().min(1).max(4000)`) and a `MESSAGE_MAX = 4000` constant.

  Keep the file's header comment, and add a line that no field carries contact details.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the server answers in the contract shape, and refuses requests across a block. US1's
"open conversation" link and US3's screens depend on both.

- [X] T002 Create `server/tests/messaging/inbox-shape.test.ts`, using `inquire`, `reply`, `inbox`
  and `readConversation` from `tests/messaging/helpers.ts`:
  - after A inquires about B's listing, B's `GET /messages/conversations` item has
    `subject.type 'marketplace_listing'`, `subject.title` = the listing title,
    `counterpart.displayName` = A's display name, and `lastMessage.excerpt` = the message;
  - `GET /messages/conversations/:id` returns the same `conversation` fields;
  - no response contains either member's email or mobile.

  Counter-assertion: A's own inbox shows B as the counterpart.
- [X] T003 In `server/src/modules/messaging/application/converse.ts`:
  - extend `listConversations`'s SQL with named columns: the listing title (`LEFT JOIN
    marketplace_listings l ON c.subject_type = 'marketplace_listing' AND l.id = c.subject_id`),
    the counterpart (the other `conversation_participants` row joined to `members`:
    `display_name`, `handle`), and the latest message (`LATERAL (SELECT sender_id,
    left(body, 140), created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at
    DESC LIMIT 1)`);
  - add a `toConversation(row)` mapper returning the contract `Conversation`;
  - make `readConversation` return the same mapped `conversation`.

  Never select `email` or `mobile`.
- [X] T004 In `server/src/modules/messaging/routes.ts` and `controller.ts`, replace the inline
  `conversationSchema` / `messageSchema` with the contract schemas from T001. Make the inbox and
  read handlers send the T003 shape. Keep postures, buckets and the `pageQuery` as they are. Run
  `tests/messaging/*` plus T002: all must pass.
- [X] T005 [P] In `server/src/modules/messaging/application/inquire.ts`, after the owner-status
  check, refuse when a `member_blocks` row exists in either direction between inquirer and owner
  by throwing `ListingNotInquirableError('unavailable')`. That's the same answer as a lapsed
  owner, so a block isn't revealed (research R7). Add a case to
  `server/tests/messaging/inquiry.test.ts`: either block direction gives a 422 with the same body
  as a lapsed owner. Counter-assertion: without a block, 201.

**Checkpoint**: `DATABASE_URL=… npx vitest run tests/messaging` is green.

---

## Phase 3: User Story 1 — Send a request from a listing (Priority: P1) 🎯 MVP

**Goal**: on the web and in the app, a member sends a request from someone else's active listing
and sees it was sent.

**Independent Test**: as A, open B's listing, send, and see "Request sent". One conversation
with A's message exists. B's own listing shows no button.

### Tests (write first)

- [X] T006 [P] [US1] Create `client/tests/member/listing-request.test.tsx`, using `renderConsole`
  and `mockCapabilityFetch(memberSnapshot(), { extraRoutes })` with stubbed
  `/marketplace/categories`, `/marketplace/listings` and `/marketplace/terms` (as in
  `tests/member/marketplace.test.tsx`):
  - a listing owned by someone else with `contact.available: true` shows **Send request**;
  - submitting text POSTs `{ body }` to `/marketplace/listings/<id>/inquire`;
  - on 201 the card shows "Request sent" with a link to `/konsole/mitglied/nachrichten/<conversationId>`;
  - a 422 `listing-not-inquirable` shows the closed-listing message;
  - an empty message cannot be sent.

  Counter-assertion: a listing whose `owner.id` equals the session member's id
  (`memberSnapshot().id`) shows no button.

### Implementation

- [X] T007 [P] [US1] Web i18n: add a `memberRequests` namespace to `client/src/i18n/de.ts` and
  `en.ts`. Keys: `send` (Anfrage senden / Send request), `dialogTitle`, `placeholder`, `counter`
  ("{n}/4000"), `submit`, `cancel`, `sent` (Anfrage gesendet / Request sent), `openConversation`,
  `closed` (this listing no longer accepts requests), `slowDown`, `failed`. Run
  `npm run -w client test:i18n`.
- [X] T008 [US1] In `client/src/member/Marketplace.tsx`, on each listing `<li>`:
  - when `listing.owner.id !== snapshot.id` and `listing.contact?.available`, render a
    **Send request** button that opens the existing `Modal` from `./threads/Modal` with a
    `<textarea maxLength={MESSAGE_MAX}>` and a counter;
  - submit with `post(`/marketplace/listings/${listing.id}/inquire`, { body })`;
  - keep a per-listing "sent" map in state of `listingId → conversationId`, and render the sent
    note and link from it;
  - on `ApiError` with type `listing-not-inquirable` show `closed`; on 429 show `slowDown`;
    otherwise log and show `failed`.

  Comment why the button is hidden on your own listing but the server still decides.
- [X] T009 [P] [US1] App: add `messagingApi` to `expo-client/german-world-club/src/api/endpoints.ts`:
  - `inquire(listingId, body)` → `InquireResponse`;
  - `inbox(cursor)` → `InboxPage`;
  - `read(id, cursor)` → `ConversationView`;
  - `reply(id, body)` → `Message`.

  All typed from `@gwc/contracts/messaging`. Add a `requests` namespace to
  `src/i18n/en.ts` / `de.ts` with the same keys as T007.
- [X] T010 [US1] App: in `expo-client/german-world-club/src/components/listing-detail.tsx`, show
  a **Send request** `Button` when the listing isn't the signed-in member's own (from
  `useSession()`) and `contact.available`. It pushes `/marketplace/request/[id]`. Create
  `expo-client/german-world-club/src/app/(member)/marketplace/request/[id].tsx`: a `FormScreen`
  with a multiline `TextField` (maxLength 4000) and Send. On success,
  `router.replace('/marketplace/messages/<conversationId>')`. Same refusal handling as T008.
  Register the screen in `(member)/marketplace/_layout.tsx`.

**Checkpoint**: US1 works alone. Requests are sent and saved; nobody is emailed yet.

---

## Phase 4: User Story 2 — The other person is told by email (Priority: P1)

**Goal**: every message emails the other participant, combined into one email per 15 minutes,
never to unreachable or blocked recipients, and with no contact details.

**Independent Test**: A sends a request and one `messaging.new-message` outbox row appears for B.
A burst of 10 gives one row with `count = 10`. B replies and one row appears for A.

### Tests (write first)

- [X] T011 [P] [US2] Create `server/tests/messaging/notify-mail.test.ts`, using the messaging
  helpers and reading `mail_outbox` directly:
  1. A's request gives exactly 1 unsent row to B's address, template `messaging.new-message`,
     `next_attempt_at` between 50 s and 70 s from now, `variables` with `listingTitle`, A's
     name, `count 1` and A's text;
  2. 9 more messages from A give still exactly 1 row, with `count 10` and 3 `messages`;
  3. after the row is marked sent (`UPDATE mail_outbox SET sent_at = now()`), one more message
     creates a second row with `next_attempt_at ≥ previous next_attempt_at + 15 min`;
  4. B's reply gives 1 row to A;
  5. no row when B is `locked`, has `email_suppressed = true`, or has blocked A;
  6. no row's `variables` contain either member's email or mobile.

  Counter-assertion: with `app.notifyMessage` unset (`delete`), no row appears, which proves the
  rows come from this feature.
- [X] T012 [P] [US2] Add a case to `server/tests/integrations/` (or the existing mail-template
  test file, if there is one; otherwise create
  `server/tests/ops/mail-template-messaging.test.ts`): `renderMail('messaging.new-message', vars,
  { origin })`'s
  - subject contains the listing title in both languages;
  - text contains the link `{origin}/konsole/mitglied/nachrichten/{conversationId}`, both
    languages' "replies are not read" sentence, and every message's sender name and text;
  - `count 3` uses the plural subject.

  Counter-assertion: an unknown template still throws or falls through as today.

### Implementation

- [X] T013 [US2] Create `server/migrations/041_message_mail.sql`: the table
  `message_mail_schedule (conversation_id uuid REFERENCES conversations ON DELETE CASCADE,
  member_id uuid REFERENCES members ON DELETE RESTRICT, pending_message_id text,
  last_scheduled_for timestamptz, PRIMARY KEY (conversation_id, member_id))`, with a header
  comment pointing to research R3. Add `'message_mail_schedule'` to `server/src/seed/tables.ts`
  next to `member_activity_cursor`, with the same comment rationale (writable; no seeded fact
  implies a row).
- [X] T014 [US2] Create `server/src/modules/messaging/application/notify-mail.ts` exporting
  `scheduleMessageMail(app, { conversationId, messageId, recipientIds })`. For each recipient, in
  its own `withTransaction`:
  1. **Eligibility (R4)**: load the recipient (`status`, `email`, `email_suppressed`,
     `display_name`), the sender (`display_name`, from the message's `sender_id`) and any
     `member_blocks` either way. Skip unless active, has an email, isn't suppressed and isn't
     blocked.
  2. `INSERT … ON CONFLICT DO NOTHING` the schedule row, then `SELECT … FOR UPDATE` it.
  3. If `pending_message_id` names an unsent `mail_outbox` row, `UPDATE mail_outbox SET
     variables = …` (count + 1; prepend this message, keep 3; body cut to 500) `WHERE message_id
     = $1 AND sent_at IS NULL`.
  4. Otherwise, insert a new outbox row via `app.enqueueMail({ to, template:
     'messaging.new-message', subjectKey: `${conversationId}:${memberId}:${messageId}`,
     variables }, { client })` with `next_attempt_at = greatest(now() + interval '60 seconds',
     coalesce(last_scheduled_for, '-infinity') + interval '15 minutes')`. Extend
     `enqueueMail`'s options with an optional `notBefore` SQL expression or `Date`, in
     `server/src/decorators/mail.ts`, keeping the existing callers unchanged. Then update the
     schedule row.

  Variables are per data-model.md, with the listing title read via the conversation's subject.
  Comment each step with why (R3).
- [X] T015 [US2] Create `server/src/decorators/message-mail.ts` with `registerMessageMail(app)`,
  which does `app.decorate('notifyMessage', (event) => scheduleMessageMail(app, event))`.
  Register it in `server/src/app.ts` right after `registerMail(app)`. Leave the `notifyMessage?`
  typing in `src/types/fastify.d.ts` optional, so suites can remove it.
- [X] T016 [US2] Add `case 'messaging.new-message'` to `renderMail` in
  `server/src/integrations/mail-templates.ts`, per contracts/http-and-ui.md: subject singular or
  plural with the listing title, body German then English via `both()`, greeting, the latest
  messages (sender name: text), the link, and the "replies are not read" line. In
  `server/src/integrations/mail.ts` `sendMail`, add the headers `{ 'Auto-Submitted':
  'auto-generated', 'X-Auto-Response-Suppress': 'All' }` for every mail (R6). Comment why.

**Checkpoint**: US1 + US2. Requests and replies email the other side.

---

## Phase 5: User Story 3 — Read and answer in the console and the app (Priority: P1)

**Goal**: a Messages area on both faces lists conversations with unread markers, opens one, and
replies. The email link lands here.

**Independent Test**: B opens Messages, sees A's request under the listing title (unread), opens
it, replies. A sees the reply. Both work on web and app.

### Tests (write first)

- [ ] T017 [P] [US3] Create `client/tests/member/messages.test.tsx`:
  - `/konsole/mitglied/nachrichten` with a stubbed `/messages/conversations` lists items showing
    the listing title, counterpart name, excerpt and an unread marker when `unreadCount > 0`;
  - `/konsole/mitglied/nachrichten/<id>` with a stubbed `/messages/conversations/<id>` shows the
    messages in chronological order;
  - replying POSTs `{ body }` to `/messages/conversations/<id>/messages` and appends the returned
    message;
  - the sidebar's Messages tab shows the unread total.

  Counter-assertion: with an empty inbox the empty state shows and there's no badge.

### Implementation

- [ ] T018 [P] [US3] Web i18n: add a `memberMessages` namespace to both catalogues: `tabLabel`
  (Nachrichten / Messages), `title`, `empty`, `unread`, `you`, `reply`, `send`, `listingClosed`,
  `loadFailed`, `back`, `about` ("zu {title}" / "about {title}"), `listingGone`. Run `test:i18n`.
- [ ] T019 [US3] Create `client/src/member/messages/Inbox.tsx`: a paged
  `GET /messages/conversations` list. Each row is a link to `nachrichten/<id>` showing the
  listing title (or `listingGone`), `counterpart.displayName`, the `lastMessage.excerpt`, a
  formatted time, and an unread pill. Include a load-failed state with retry. Newest first.
- [ ] T020 [US3] Create `client/src/member/messages/Conversation.tsx`:
  - `GET /messages/conversations/:id`; the messages arrive newest first, so reverse them for
    display;
  - own messages (`senderId === snapshot.id`) aligned right;
  - a header with `about {title}` and Back;
  - a reply `textarea` (max 4000) posting to `/messages/conversations/:id/messages` and
    appending the result;
  - 404 → a not-found state; 429 → `slowDown` from `memberRequests`.
- [ ] T021 [US3] Wire the web routes and tab:
  - `nachrichten` and `nachrichten/:id` under `/konsole/mitglied` in
    `client/src/console/routes.tsx`;
  - a Messages item in `client/src/member/MemberLayout.tsx` with an unread badge (sum of
    `unreadCount` over the first inbox page), polled with the same `useUnread`-style hook
    (visibility-aware, 60 s, refresh on focus) as Activity's badge;
  - add `nachrichten` to any route-guard or unbuilt-area lists that enumerate member tabs.
- [X] T022 [P] [US3] App: create
  `expo-client/german-world-club/src/app/(member)/marketplace/messages/index.tsx` (inbox, using
  `usePaged(messagingApi.inbox)`, rows → `[id]`) and `messages/[id].tsx` (conversation, reply
  box, own messages right-aligned). Register both in `(member)/marketplace/_layout.tsx`. Add i18n
  keys under `requests`/`messages` to both app catalogues.
- [X] T023 [US3] App: in `expo-client/german-world-club/src/app/(member)/marketplace/index.tsx`,
  add a `headerRight` mail icon (or a text button if no icon component exists) that pushes
  `/marketplace/messages`, with a dot when the inbox's total `unreadCount > 0`, re-read on focus.

**Checkpoint**: all three stories work on both faces.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T024 [P] Add a short paragraph to `CLAUDE.md`'s marketplace/messaging section: requests use
  008's inquiry; `app.notifyMessage` is the email scheduler; there's one pending email per
  recipient per conversation, merged under a row lock, spaced 15 minutes apart, with nothing
  dropped (research R3); emails are bilingual and replies to them aren't read; recipients who
  are blocked, locked, suppressed or have no address are skipped.
- [ ] T025 [P] Add a `MAIL_FROM` note to `server/README.md`'s Environment table: it should be a
  no-reply address, because message emails tell people replies aren't read (R6).
- [ ] T026 Run the gates:
  - `DATABASE_URL=… npx vitest run` in `server/` (compare against the known failures already on
    `main`: the `seed:demo` gate and 3 resilience budget tests);
  - `npm run -w client test` and `test:i18n`;
  - `tsc --noEmit` for `client` and `expo-client/german-world-club`, plus `expo lint`.

  Fix anything new.
- [ ] T027 Walk `specs/020-listing-requests/quickstart.md` steps 1–9 with two browser sessions and
  the app, and record the outcomes in that file.

---

## Dependencies & Execution Order

- **Setup (T001)** blocks everything that imports the new shapes.
- **Foundational (T002–T005)**:
  - T003 needs T001;
  - T004 needs T001 and T003;
  - T005 is independent (same module, different file).
- **US1 (T006–T010)**: needs Phase 2, for the conversation id link and block refusal.
  - T008 needs T007;
  - T010 needs T009.
- **US2 (T011–T016)**: needs only T001–T004 for typing. It's independent of US1's clients and
  can run in parallel with US1.
  - T014 needs T013;
  - T015 needs T014;
  - T016 is independent.
- **US3 (T017–T023)**: needs Phase 2.
  - Web T019–T021 need T018;
  - App T022–T023 need T009.
- **Polish** after the stories.

### Parallel opportunities

- After Phase 2:
  - US1 web (T006–T008), US1 app (T009–T010) and US2 server (T011–T016) are different files;
  - US3 web (T017–T021) and US3 app (T022–T023) can follow alongside.
- Within US2: T011, T012 and T016 together; then T013 → T014 → T015.

## Parallel Example: after Phase 2

```bash
# Three developers:
US1 web:  T006 → T007 → T008
US1 app:  T009 → T010
US2:      T011, T012, T016  then  T013 → T014 → T015
```

## Implementation Strategy

### MVP first

1. Phases 1–2 (contract shapes, block refusal).
2. **US1 + US2 together** are the minimum anyone would notice. A request with no email reaches
   nobody, and an email with nowhere to answer is a dead end. So:
3. **US3 completes the loop**: ship US1–US3 together for members. If time forces a cut, ship web
   US1–US3 first and the app (T009, T010, T022, T023) right after. The email links to the web
   console either way.

### Notes

- Commit after each task or logical group.
- If T014's per-recipient transaction turns out to contend under load, the R3 row lock is the
  place to look. Don't move batching into the rate limiter (CLAUDE.md: rate limits are not quotas).
