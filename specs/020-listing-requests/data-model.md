# Data model: listing requests with email updates

One migration, `server/migrations/041_message_mail.sql`. Everything else exists from 008
(`018_messaging.sql`) and 009 (`021_mail_outbox.sql`).

## Existing, unchanged

| Table | Used for |
|---|---|
| `conversations` (`subject_type = 'marketplace_listing'`, `subject_id` = listing) | One per requester per listing (enforced by `inquire()`) |
| `conversation_participants` (`last_read_at`) | Who is in it; unread counts; set when a conversation is opened |
| `messages` (`body` 1–4000, `CHECK`) | The request and every reply |
| `mail_outbox` | The email, retried by `mail.deliver`, `variables` cleared after sending |
| `member_blocks` | Refuses new requests and suppresses email across a block (R4, R7) |

## New: `message_mail_schedule`

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | uuid → conversations, ON DELETE CASCADE | PK part |
| `member_id` | uuid → members, ON DELETE RESTRICT | PK part; the recipient |
| `pending_message_id` | text NULL | `mail_outbox.message_id` of the unsent email being merged into; NULL once sent |
| `last_scheduled_for` | timestamptz NULL | When the latest email was scheduled to leave; the 15-minute spacing starts here |

PK `(conversation_id, member_id)`. One row per recipient per conversation, created on the first
message they're notified about. It's operational state, not history: rows may be updated.

**Algorithm (R3)**, per recipient, in one transaction:

```text
SELECT … FROM message_mail_schedule WHERE (conv, member) FOR UPDATE   -- insert if missing
if pending_message_id and mail_outbox[pending].sent_at IS NULL:
    UPDATE mail_outbox SET variables = merge(variables, message)       -- count+1, latest 3
else:
    when = greatest(now() + 60s, coalesce(last_scheduled_for, -inf) + 15 min)
    INSERT mail_outbox (message_id = new, next_attempt_at = when, template = 'messaging.new-message', …)
    UPDATE schedule SET pending_message_id = new, last_scheduled_for = when
```

## Mail variables (`messaging.new-message`)

| Key | Content |
|---|---|
| `recipientName` | the recipient's display name |
| `listingTitle` | the title when the first message in this email arrived |
| `conversationId` | for the link: `{origin}/konsole/mitglied/nachrichten/{id}` |
| `count` | messages in this email |
| `messages` | the latest 3, each `{ senderName, body ≤ 500 chars, at }` |

No email address, phone number or member id of the sender (FR-005). `mail.deliver` clears these
after sending.

## Contract changes (`@gwc/contracts/messaging`)

`Conversation`:
- `subject` gains `title: string | null`;
- new `counterpart: { memberId, displayName, handle }`;
- new `lastMessage: { senderId, excerpt (≤ 140), createdAt } | null`.

New `InboxPage` = `{ items: Conversation[], nextCursor }`. Request and response schemas move into
contracts (R8).

## Seed

`message_mail_schedule` goes under `HISTORY`-free **SEEDED = no rows**, because no seeded fact
implies a scheduled email. It's listed in `server/src/seed/tables.ts` as written-by-the-
application, the way `member_activity_cursor` is.
