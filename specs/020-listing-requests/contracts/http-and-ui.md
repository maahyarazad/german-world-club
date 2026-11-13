# Contracts: listing requests

## HTTP (all `audience: 'member'`, existing postures)

| Route | Change in 020 |
|---|---|
| `POST /marketplace/listings/:id/inquire` `{ body }` → `201 { conversationId, created, message }` | Also refuses `410 gone` when either side has blocked the other, the same answer as a closed listing or a lapsed owner (R7). Unchanged otherwise. |
| `POST /messages/conversations/:id/messages` `{ body }` → `201 Message` | None. It already triggers notification. |
| `GET /messages/conversations?cursor=` → `InboxPage` | Response is the contract shape, with `subject.title`, `counterpart` and `lastMessage` (R8) |
| `GET /messages/conversations/:id?cursor=` → `{ conversation, participants, messages, nextCursor }` | `conversation` gains the same fields. Still marks it read. |

Refusals keep their existing types: 404 `not-found` (not a participant / no such listing),
410 `gone` (closed listing, lapsed owner or block), 400 `validation-failed` (own listing, empty or
too long), and 429 `rate-limited` (message flood limit). No new problem types.

## Email: `messaging.new-message`

- **Subject**: `Neue Nachricht zu „{listingTitle}“ / New message about "{listingTitle}"`. With
  `count > 1`: `{count} neue Nachrichten zu … / {count} new messages about …`.
- **Body**, German then English:
  1. a greeting;
  2. who wrote, and about which listing;
  3. the latest ≤ 3 messages (name and text);
  4. the link `{origin}/konsole/mitglied/nachrichten/{conversationId}`;
  5. "Antworten auf diese E-Mail werden nicht gelesen … / Replies to this email are not read —
     answer through the link".
- **Headers**: `Auto-Submitted: auto-generated`, `X-Auto-Response-Suppress: All`.
- Never contains an email address or phone number of either party.

## Web console

| Where | What |
|---|---|
| Member Marketplace listing card (someone else's, `contact.available`) | **Anfrage senden / Send request** opens a dialog: textarea (1–4000, counter), Send, Cancel. On success the card shows **Anfrage gesendet – Unterhaltung öffnen / Request sent – open conversation**. Refusals: closed listing → "This listing no longer accepts requests"; 429 → "Slow down, try again in a moment". Everything else is logged to the console (CLAUDE.md) with a generic "Could not send". |
| Sidebar | **Nachrichten / Messages** tab with an unread badge (sum of `unreadCount`, polled like Activity) |
| `/konsole/mitglied/nachrichten` | Inbox: listing title, counterpart name, latest message excerpt, time, unread marker. Newest first, paged. Empty state. |
| `/konsole/mitglied/nachrichten/:id` | Conversation: listing title (links to the marketplace), messages in order (own ones aligned right), a reply box. A closed listing shows a note, and replies still work. |

## App

| Where | What |
|---|---|
| `components/listing-detail.tsx` | **Send request** button (not on own listing, only when `contact.available`) → pushes `marketplace/request/[id]` |
| `(member)/marketplace/request/[id].tsx` | Compose screen. Same rules and messages as the web dialog. On success, replaces itself with the conversation. |
| Marketplace header | Mail icon (`headerRight`) with an unread dot → `marketplace/messages` |
| `(member)/marketplace/messages/index.tsx`, `[id].tsx` | Inbox and conversation, the same content as the web |

All strings are in both catalogues on both faces. A refusal is logged with
`console.error('<Component>.<fn>', problem)`. Only the closed-listing and slow-down cases are
shown, because the member can't proceed without knowing why.
