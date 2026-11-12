# Quickstart: validating listing requests with email updates

Contracts: [contracts/http-and-ui.md](./contracts/http-and-ui.md). Tables:
[data-model.md](./data-model.md).

## Setup

```bash
npm run -w server migrate          # applies 041_message_mail.sql
npm run -w server seed:demo        # members and active listings
npm run -w server dev              # NODE_ENV=development logs queued mail with its contents
npm run -w client dev
```

## Automated

```bash
DATABASE_URL=postgres://…/gwc_test npm run -w server test -- messaging
npm run -w client test && npm run -w client test:i18n
npx tsc --noEmit -p client && npx tsc --noEmit -p expo-client/german-world-club
```

## By hand (two browsers, or one normal and one private window)

1. **A sends a request.** Sign in as member A and open Marketplace. On B's active listing, Send
   request → write → Send. The card says "Request sent". Within about 2 minutes the server log
   shows `mail queued … messaging.new-message` to B, with the listing title, A's name and the
   text, and no email address or phone.
2. **No button on your own listing**, and none on a sold or withdrawn one.
3. **B replies.** As B: Messages shows the conversation, bold or unread. Open it and reply. About
   2 minutes later, one email is queued to A.
4. **Burst.** As A, send 5 quick messages. Exactly one more email to B, saying "5 new messages".
5. **Spacing.** Right after that email leaves, A sends one more. Its email is scheduled at
   least 15 minutes after the previous one.
6. **Closed listing.** B marks the listing sold. A can still open and reply in the
   conversation. A third member C can no longer send a request.
7. **Locked / blocked.** Lock A (staff console), or block between A and B (Threads). No new
   request is possible, and no email goes to the locked or blocked side.
8. **App.** As A, Marketplace → a listing → Send request. The mail icon shows the unread dot
   when B has replied.
9. **Languages.** Repeat step 1 with the console in English. The email contains both languages
   either way.

## Walkthrough record (2026-11-12)

Not yet walked by hand (T027 open). What the automated suites already prove, per step:

| Step | Covered by |
|---|---|
| 1 A sends a request; email queued to B | `client/tests/member/listing-request.test.tsx`, `server/tests/messaging/notify-mail.test.ts` |
| 2 No button on own / closed listing | `listing-request.test.tsx`; server refusals in `tests/messaging/inquiry.test.ts` |
| 3 B reads (unread) and replies; email to A | `client/tests/member/messages.test.tsx`, `notify-mail.test.ts` |
| 4 Burst → one email "N new messages" | `notify-mail.test.ts` |
| 5 Next email ≥ 15 min after the last | `notify-mail.test.ts` |
| 6 Closed listing: old conversation still answerable | `inquiry.test.ts` (008 FR-027) |
| 7 Locked / blocked: no request, no email | `inquiry.test.ts`, `notify-mail.test.ts` |
| 8 App | `tsc` only. Needs a device. |
| 9 Email content, both languages | `server/tests/ops/mail-smtp.test.ts` |

Still needs a person: the app screens on a device, and a real email arriving in a real mailbox
(SMTP configured).
