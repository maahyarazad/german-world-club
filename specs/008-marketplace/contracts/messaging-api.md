# Contract: Messaging (Persistence and Inquiry)

**Feature**: 008-marketplace

The contact method behind §7's marketplace. **Persistence and the inquiry flow
only** — real-time transport, typing indicators and read receipts are a later
feature (research.md R13).

The split is the order the Technology & Security Baseline states:

> Real-time transport is additive — a message MUST be persisted before it is
> delivered, so a dropped connection never loses data.

## Posture

```ts
config: { auth: { audience: 'member' }, budget: 'messaging' }
```

Member-audience, gated, never indexed. `/messages` is **already** declared gated
and never-indexed in `seo/surfaces.ts` with the reason "Private correspondence",
so this feature continues a declaration rather than making one.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/messages/conversations` | The inbox, newest activity first |
| `GET` | `/messages/conversations/:id` | One conversation, keyset-paged |
| `POST` | `/messages/conversations/:id/messages` | Reply |
| `POST` | `/marketplace/listings/:id/inquire` | Start a conversation about a listing |

The inquiry endpoint lives under `/marketplace` because that is the resource it
acts on and the guard it needs — the listing must be inquirable. It creates a
conversation the messaging endpoints then own.

## Ordering: persist, then notify

A message is **committed before** any notification is attempted.

Notification is a step *after* commit, never inside the transaction. A
transaction that rolled back because a push failed would lose a message the
sender was told was accepted — which is exactly the data loss the Baseline
clause exists to prevent.

**Assertion (SC-011)**: fail the notification path deliberately and confirm the
message is still in the database and readable by the recipient.

## What is not here

- **No `delivered_at` or `read_at`.** Delivery is on read. A column nothing
  writes is a promise the schema cannot keep; real-time adds them with the
  transport that can set them.
- **No WebSocket.** Additive, later.
- **No group conversations.** `conversation_participants` allows them; nothing
  here models them.
- **No notification preferences.** §7's opt-in matrix is its own feature.

## Privacy

**No response from any endpoint here may carry an email address or a phone
number** — not the sender's, not the recipient's (FR-026).

A conversation response carries display identity and message bodies. That is
already two members' data in one payload, and with response schemas removed by
constitution 2.0.0 the only thing shaping it is the explicit-columns rule. This
is the payload where forgetting it is worst, which is why the assertion is
specific rather than relying on the general convention.

The listing stores a contact *preference*; the conversation is how that
preference is honoured. Neither is a place to put a contact *value* (R9).

## Refusals

| Situation | Problem | Status |
|---|---|---|
| Not signed in | `UNAUTHENTICATED` | 401 |
| Not a participant | `NOT_FOUND` | **404** |
| Listing not inquirable (withdrawn, sold, expired, hidden) | `GONE` | 410 |
| Inquiring on your own listing | `VALIDATION_FAILED` | 400 |
| Message too long / empty | `VALIDATION_FAILED` | 400 |
| Too many messages | `RATE_LIMITED` | 429 |

**404, not 403, for a non-participant** — the `guardOrganisationScope`
precedent again. A 403 confirms the conversation exists, which turns id-guessing
into discovering who is talking to whom. For private correspondence that is a
worse disclosure than for a listing.

**429 here is correct**, unlike the marketplace listing quota. Message volume is
a transport limit — wait and it works. A listing cap is a business quota where
retrying changes nothing until state does, which is why that one is 422. The two
sit in the same feature and must not be flattened together.

## Existing conversations outlive their listing

A withdrawn, sold or hidden listing refuses **new** inquiries and leaves existing
conversations readable by both parties (FR-027).

Two people mid-negotiation when the seller marks something sold should not lose
the thread — and a conversation that vanished would take the record of what was
agreed with it.

## Assertions

1. A message is persisted before notification; failing the notification path
   leaves the message intact and readable.
2. No response carries an email address or phone number for either party.
3. A non-participant gets 404, byte-identical to a conversation that does not
   exist.
4. An inquiry on a withdrawn listing is refused; the existing conversation about
   it still reads.
5. Message volume limiting is 429; the marketplace listing cap is 422. Both are
   asserted, because flattening them is the easy mistake.
6. `grep -rn "SELECT \*" server/src/modules/messaging/` returns nothing.
