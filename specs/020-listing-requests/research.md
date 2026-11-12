# Research: Send a request about a marketplace listing, with email updates

## R1. Reuse 008's inquiry and conversation endpoints

**Decision**: no new endpoint for sending:
- `POST /marketplace/listings/:id/inquire` sends a request. It's idempotent per (listing,
  requester): a second request appends to the same conversation (spec US1 scenario 5).
- `POST /messages/conversations/:id/messages` sends a reply.
- `GET /messages/conversations` is the inbox.
- `GET /messages/conversations/:id` opens a conversation and marks it read.

**Rationale**: the rules are already built and tested (`tests/messaging/*`): persist before
notify, refuse closed listings while keeping old conversations, no contact details, flood limit.
The gap is clients and notification.

## R2. Email is the empty `app.notifyMessage` hook, filled

**Decision**: add `server/src/decorators/message-mail.ts`, which decorates `app.notifyMessage`
with `scheduleMessageMail` (in `server/src/modules/messaging/application/notify-mail.ts`). Both
the inquiry and the reply paths already call `notifyAfterCommit`, which calls it after the
message is committed and swallows failures.

**Rationale**: this is the slot 008 left for exactly this, so FR-008 (saved before any email; an
email failure never undoes the message) is already true by construction. It is covered by
`tests/messaging/persist-before-notify.test.ts`. Delivery goes through the existing outbox
(`app.enqueueMail` → `mail.deliver` job, every minute, retry with backoff, variables cleared
after sending).

## R3. Combining messages: one pending email per recipient per conversation

**Decision**: a new table `message_mail_schedule (conversation_id, member_id)` holds the
recipient's **pending** outbox row and when the last email to them in that conversation was
scheduled. For each recipient, in one transaction holding a row lock on their schedule row:

1. If the pending outbox row exists and is still unsent, **merge**: update its `variables`
   (message count + 1, keep the latest 3 messages, each cut to 500 characters). No new email.
2. Otherwise **schedule** a new outbox row with
   `next_attempt_at = greatest(now() + 60 s, last_scheduled_at + 15 min)` and remember it as
   pending.

**Rationale**:
- FR-009 (one email per recipient per 15 minutes per conversation) and SC-005 hold under
  concurrency because of the row lock.
- The 60-second hold lets a quick back-and-forth land in one email, and still meets SC-002
  (95% sent within 2 minutes, with the job ticking every minute).
- A message after an email was sent goes into the next one, scheduled 15 minutes after the last.
  It isn't dropped, which a fixed time window would have done.

**Alternatives considered**:
- *Dedupe by a fixed 15-minute window key*: drops every message after the first in a window
  from email.
- *A digest job*: a second scheduling mechanism alongside the outbox.

## R4. Who is emailed, and who isn't (FR-006, FR-010)

**Decision**: every participant except the sender, skipped when any of these holds:
- the member's `status` isn't `active`;
- they have no email address;
- `email_suppressed` is set (the existing bounce handling);
- either participant has blocked the other (`member_blocks`).

**Rationale**: the spec's edge cases. The checks run when the email is scheduled, and are
re-checked when merging.

## R5. Language: German then English in one email, as every platform mail is

**Decision**: template `messaging.new-message` in `server/src/integrations/mail-templates.ts`:
German first, then English, plain text. The subject is
`Neue Nachricht zu „{title}“ / New message about "{title}"`.

**Rationale**: members have no stored interface language. The console keeps it in the browser
and the app on the device, and `mail-templates.ts` states this exact convention for every mail.
The spec's FR-007 is amended to say so. Adding a stored language preference would be a separate
feature touching every mail.

## R6. No replies to the email (FR-013)

**Decision**: the email body says, in both languages, that replies to the email aren't read and
to answer through the link. The email also carries the headers `Auto-Submitted: auto-generated`
and `X-Auto-Response-Suppress: All`, so auto-responders don't answer it. Production's `MAIL_FROM`
should be a no-reply address; the server README says so.

**Rationale**: inbound mail was ruled out (Q2). Most mail clients honour these headers, and the
body text covers the rest.

## R7. A request needs a recipient who can be reached

**Decision**: `inquire()` additionally refuses when either side blocked the other. It answers
`422 listing-not-inquirable`, the same refusal as a closed listing, so a block isn't revealed.
The message length stays at the existing **1–4000** characters (the database `CHECK` in
`018_messaging.sql`). The spec's FR-004 (2000) is amended to match, rather than tightening a
constraint that existing data obeys.

## R8. The inbox response matches the contract and says what each conversation is about

**Decision**: `GET /messages/conversations` and `GET /messages/conversations/:id` return the
`@gwc/contracts/messaging` shape. `Conversation` gains:
- `subject.title` (the listing title, or `null` if the listing is gone);
- `counterpart` (the other member's `memberId`, `displayName` and `handle`);
- `lastMessage` (`senderId`, body excerpt up to 140 characters, `createdAt`).

The route schemas are imported from contracts instead of being declared inline.

**Rationale**: the Messages list (FR-011) needs the title and the other person's name, and today
the server returns a flatter shape (`subjectType`, `subjectId`) than the contract it's meant to
match. Nothing consumed it, which is why the drift went unnoticed. Names only: no email or phone
(FR-005, 008 FR-026). The columns are named, as `tests/messaging/no-select-star.test.ts` enforces.

## R9. Web: a request dialog on the listing card, and a Messages tab

**Decision**:
- **`member/Marketplace.tsx`**: each listing card from someone else, with
  `contact.available === true`, gets **Send request**. It opens the existing threads `Modal` with
  a textarea and a counter. After sending, the card shows "Request sent: open conversation",
  linking to `/konsole/mitglied/nachrichten/:id`. Own listings have no button (compared against
  the session member's id).
- **New `member/messages/Inbox.tsx` and `Conversation.tsx`** at `/konsole/mitglied/nachrichten`
  and `/:id`, with a sidebar tab carrying the unread count (polled like Activity's badge).
- `/messages` is already in the dev proxy's `API_PREFIXES`.

## R10. App: from the listing detail, and Messages in the marketplace stack

**Decision**:
- **`components/listing-detail.tsx`** gets **Send request**, which pushes
  `(member)/marketplace/request/[id].tsx` (a compose screen).
- **Messages lives at `(member)/marketplace/messages/index.tsx` and `[id].tsx`**, reached from a
  `headerRight` mail icon on the marketplace screen with an unread dot. All five bottom-bar slots
  are taken (017 R7).
- The email link is a web URL (`/konsole/mitglied/nachrichten/:id`). Opening it in the app needs
  universal links for `/konsole/mitglied/nachrichten/*`, which this feature doesn't add. The
  console opens in the browser.

## R11. Tests

- **Server**: `tests/messaging/notify-mail.test.ts` covers:
  - one email per new request, to the owner;
  - a reply emails the requester;
  - 10 messages in a burst produce one email, with `count = 10`;
  - a message after an email was sent schedules the next one ≥ 15 minutes later;
  - no email to a locked, suppressed or address-less recipient, or across a block;
  - the email has no contact details.

  `tests/messaging/inquiry.test.ts` gains the block refusal. `tests/messaging/inbox-shape.test.ts`
  covers the R8 fields and their absence of PII.
- **Web**: `tests/member/listing-request.test.tsx`, `tests/member/messages.test.tsx`.
- **App**: `tsc` + lint, plus the quickstart steps.
