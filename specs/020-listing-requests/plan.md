# Implementation Plan: Send a request about a marketplace listing, with email updates

**Branch**: `020-listing-requests` | **Date**: 2026-11-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/020-listing-requests/spec.md`

## Summary

Feature 008 built the server side of requests: inquiring about a listing creates or continues a
conversation, both sides can reply, and every message is saved before anyone is notified. What's
missing is everything people see and receive. This plan adds:

1. **Email**: the empty `app.notifyMessage` hook is filled with a scheduler that writes to the
   existing mail outbox. Every message emails the other participant. Messages are combined, so
   each recipient gets at most one email per conversation per 15 minutes, and none is dropped
   (R3). Locked, suppressed, address-less and blocked recipients are skipped (R4). The email is
   in German and English like every platform mail (R5), and says replies to it aren't read (R6).
2. **Web**: a Send request dialog on each listing card, and a Messages tab with an inbox and a
   conversation view.
3. **App**: Send request from the listing detail, and Messages inside the marketplace stack.
4. **Small server changes**: blocks refuse new requests (R7), and the inbox and conversation
   responses match the shared contract, adding the listing title, the other person's name and
   the latest message (R8).

## Technical Context

**Language/Version**: TypeScript. Node 22 + Fastify 5 (server); React 19 + Vite (web); Expo
SDK 57 (app).

**Primary Dependencies**: existing ones only: `app.enqueueMail` / `mail_outbox` / `mail.deliver`,
the messaging module, and `@gwc/contracts/messaging`. No new packages.

**Storage**: PostgreSQL. One new table, `message_mail_schedule` (data-model.md), plus outbox rows.

**Testing**: Vitest against real Postgres (server), Vitest + Testing Library (web), and
`tsc` + lint (app). Suites are listed in research R11.

**Target Platform**: Linux server, browsers, iOS/Android.

**Project Type**: one API, two clients.

**Performance Goals**: sending a request or reply adds one transaction per recipient (two at
most) after commit, outside the response's critical path. 95% of emails go out within 2 minutes
(SC-002).

**Constraints**:
- Saved before notified (008 FR-025).
- No contact details anywhere (FR-005).
- No new problem types.
- The server emits no localised API text; mails are bilingual by existing convention.
- Clients log refusals instead of storing them, except where the member can't proceed.

**Scale/Scope**:
- Server: 1 migration, ~3 new files (decorator, scheduler, template case), ~4 changed files
  (inquire, converse list/read, routes schemas, contracts).
- Web: 3 new screens or components, 2 changed files.
- App: 4 new screens, 2 changed files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Engaged? | Verdict |
|---|---|---|
| I. One rule set, three clients | Who may request, length and closed listings | **PASS.** All of it is decided by the server (`inquire()`). Clients only *hide* the button on their own or closed listings, and the server re-checks. Shapes move into `@gwc/contracts/messaging` (R8). |
| II. Declare every posture | Routes | **PASS.** No new route. Existing `/messages` and `/marketplace` postures are unchanged; `/messages` is already gated and never indexed. |
| III. Published state = real state | No | **PASS.** |
| IV. Integrity in the database | Email batching under concurrency | **PASS.** One email per recipient per window is enforced under a row lock on `message_mail_schedule` (R3). The outbox `message_id` is the deterministic retry reference. |
| V. Failure explicit and bounded | Email | **PASS.** Notification runs after commit and swallows failures (existing `notifyAfterCommit`). Mail is in no route's budget; `mail.deliver` retries with backoff. |
| VI. Server shapes what leaves it | Inbox, conversation, email | **PASS.** Named columns only (`no-select-star.test.ts`); names but never emails or phones. The email carries display names and text only, and its variables are cleared after sending. |

**Post-design re-check**: unchanged, all PASS.

## Project Structure

### Documentation

```text
specs/020-listing-requests/
├── spec.md · plan.md · research.md (R1–R11) · data-model.md · quickstart.md
├── contracts/http-and-ui.md
└── checklists/requirements.md
```

### Source Code

```text
packages/contracts/src/messaging.ts              Conversation + title/counterpart/lastMessage; InboxPage; zod schemas (R8)

server/
├── migrations/041_message_mail.sql              NEW  message_mail_schedule
├── src/decorators/message-mail.ts               NEW  app.notifyMessage = scheduleMessageMail (R2)
├── src/modules/messaging/application/notify-mail.ts NEW  schedule / merge per recipient (R3, R4)
├── src/modules/messaging/application/inquire.ts block refusal (R7)
├── src/modules/messaging/application/converse.ts list/read return the contract shape (R8)
├── src/modules/messaging/routes.ts              response schemas from contracts
├── src/integrations/mail-templates.ts           + messaging.new-message (R5, R6)
├── src/integrations/mail.ts                     Auto-Submitted / X-Auto-Response-Suppress headers (R6)
├── src/app.ts                                   register the decorator
├── src/seed/tables.ts                           + message_mail_schedule
└── tests/messaging/{notify-mail,inbox-shape}.test.ts NEW; inquiry.test.ts + block case

client/src/
├── member/Marketplace.tsx                       Send request dialog on cards
├── member/messages/{Inbox,Conversation}.tsx     NEW
├── member/MemberLayout.tsx, console/routes.tsx  Messages tab + routes, unread badge
└── i18n/{de,en}.ts                              memberMessages namespace
client/tests/member/{listing-request,messages}.test.tsx NEW

expo-client/german-world-club/src/
├── components/listing-detail.tsx                Send request button
├── app/(member)/marketplace/request/[id].tsx    NEW compose
├── app/(member)/marketplace/messages/{index,[id]}.tsx NEW
├── app/(member)/marketplace/_layout.tsx, index.tsx headerRight mail icon, screens
├── api/endpoints.ts                             messagingApi
└── i18n/{en,de}.ts
```

**Structure Decision**: email scheduling lives in `modules/messaging/application/` and is wired
through the existing decorator slot. Messaging owns conversations, and the marketplace only
supplies the subject (as in 008).

## Risks

- **`MAIL_FROM` may be a real inbox**, in which case replies to the email land there. The email
  says replies aren't read and carries auto-reply suppression headers. Production should use a
  no-reply address (README note).
- **Email links open the web console**, even on a phone with the app installed. Universal links
  for `/konsole/mitglied/nachrichten/*` would be a follow-up, and need another native build.
- **The inbox response shape changes.** No client consumed it before this feature, which is
  verified by the absence of any `/messages` call in `client/` and the app. So nothing breaks.
- **Bilingual emails** instead of the recipient's language (spec FR-007 amended): there's no
  stored language to choose by.

## Complexity Tracking

None.
