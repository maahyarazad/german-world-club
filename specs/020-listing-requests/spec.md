# Feature Specification: Send a request about a marketplace listing, with email updates

**Feature Branch**: `020-listing-requests`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "switching to market place only view the listing […] use cannot interact with that so add the feature where use can send a request to the listing and they will get updated by email"

> **What exists today.** Feature 008 (User Story 5) built inquiries on the server. A member can
> open a conversation about a listing, both sides can reply, and every message is saved before
> anyone is notified. But neither the web console nor the app shows any way to do this. A
> listing card such as "Suche gebrauchtes Kinderfahrrad 20 Zoll · Request · General ·
> 23/09/2026 · Judith Schmidt" can only be read. Nobody is notified of anything either: the hook
> for telling a member about a new message exists and nothing fills it. This feature adds the
> visible half (a way to send a request, a place to read and answer it) and the email that tells
> people something arrived.
>
> "Request" in this spec means a member's message to a listing's owner about that listing. It is
> unrelated to the listing *mode* that is also called "Request" (a wanted ad, like the bicycle
> above). Both kinds of listing can receive requests.

## Clarifications

### Session 2026-11-12

- Q: Who is emailed, and for which messages? → A: **Both sides, for every new message.** The
  owner is emailed when a request arrives, the requester when the owner replies, and so on.
  Messages within 15 minutes in one conversation are combined into one email per recipient.
- Q: How are replies made? → A: **In the console and the app only.** The email links to the
  conversation. Replying to the email itself is not supported, which keeps both addresses
  private.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Send a request from a listing (Priority: P1)

A member browsing the Marketplace sees a listing they can help with or are interested in. They
open it, write a short message ("I have a 20-inch bike, barely used. Still looking?") and send
it. They see that it was sent. They don't learn the owner's email address or phone number, and
the owner doesn't learn theirs.

**Why this priority**: it's the gap the request names. Today a listing is a notice nobody can
answer.

**Independent test**: as member A, open member B's listing, send a request, and see it confirmed.
In the data, one conversation linked to that listing exists with A's message in it.

**Acceptance Scenarios**:

1. **Given** an active listing by someone else, **When** a member opens it, **Then** they see a
   way to send a request.
2. **Given** a member writing a request, **When** they send it, **Then** it's saved and they see
   that it was sent.
3. **Given** a member's own listing, **When** they open it, **Then** there's no way to send
   themselves a request.
4. **Given** a listing that is sold, filled, withdrawn, expired or hidden, **When** a member
   opens it, **Then** they can't start a new request, and are told why in plain words.
5. **Given** a member who already sent a request about this listing, **When** they open it
   again, **Then** they continue that same conversation instead of starting a second one.
6. **Given** an empty message, or one longer than the allowed length, **When** the member tries
   to send it, **Then** it isn't sent and the form says what to fix.

---

### User Story 2 — The owner is told by email (Priority: P1)

When a request arrives, the listing's owner gets an email in their language. It says which
listing it's about, who sent it (their name on the platform) and what they wrote, with a link
that opens the conversation in the console. When the owner replies, the requester gets the
same kind of email.

**Why this priority**: it's the second half of the request. A message nobody is told about waits
until someone happens to look.

**Independent test**: send a request as A. The owner B's mailbox receives one email naming the
listing and A, with the message and a working link. B replies, and A receives one email.

**Acceptance Scenarios**:

1. **Given** a new request, **When** it's saved, **Then** the owner receives one email. Every
   later message in the conversation emails the other participant the same way.
2. **Given** an email about a request or reply, **When** it's read, **Then** it shows the
   listing title, the sender's platform display name, the message text and a link to the
   conversation. It contains no email address or phone number of the sender.
3. **Given** email delivery fails or is slow, **When** a request is sent, **Then** the request
   is still saved and shown as sent. The email is retried and never blocks or undoes the
   message.
4. **Given** several messages in the same conversation within a short time, **When** emails go
   out, **Then** the recipient gets one email summarising them, not one per message.

---

### User Story 3 — Read and answer requests in the console and the app (Priority: P1)

Members have a Messages area listing their conversations, newest first, each showing which
listing it's about and whether something new arrived. Opening one shows the messages in order,
and they can reply. The email link lands here.

**Why this priority**: an email about a request is useless if the owner has nowhere to answer
it. This is the "updated" half of the conversation for both sides.

**Independent test**: B opens Messages, sees A's request under the bicycle listing, and replies.
A opens Messages and reads the reply. Both work on the web and in the app.

**Acceptance Scenarios**:

1. **Given** a member with conversations, **When** they open Messages, **Then** they see each
   conversation with its listing's title, the other person's display name, the latest message
   and its time, newest first.
2. **Given** a conversation, **When** a member opens it, **Then** they see every message in
   order and can send a reply.
3. **Given** a listing that has since closed (sold, withdrawn, hidden), **When** either side
   opens the conversation, **Then** it's still readable and replies still work. Only *new*
   requests are refused.
4. **Given** a member who isn't part of a conversation, **When** they try to open it by its
   address, **Then** they're told it doesn't exist.
5. **Given** a request email, **When** the recipient replies to the email itself, **Then**
   nothing is delivered. The email says, in its text, to answer in the console or the app
   through its link.

---

### Edge Cases

- **The owner is locked or their membership ended.** No new request can be started. An existing
  conversation stays readable to the other side, and no email is sent to an account that can't
  sign in.
- **The requester blocked the owner, or the owner blocked the requester** (Threads blocks).
  [Assumed: blocking applies here too. No new request either way, and no email.]
- **A member sends many requests in a short time.** The platform's existing message flood limit
  applies, and the member is told to slow down.
- **An email address bounces.** It's handled the way the platform handles every other mail
  (bounce count, suppression). The conversation is unaffected.
- **The listing is edited after a request.** The conversation keeps pointing at the listing.
  The email shows the title at the time it was sent.
- **The owner has no email address on file** (legacy accounts). The request is saved and
  visible in Messages, and no email is sent.
- **Language.** Each email contains German and then English, like every platform mail.

## Requirements *(mandatory)*

### Functional Requirements

**Sending a request**

- **FR-001**: A member MUST be able to send a request from any active listing they don't own,
  on the web console and in the app.
- **FR-002**: A request MUST be linked to its listing, and there MUST be at most one
  conversation per member per listing. Opening the listing again continues it.
- **FR-003**: A new request MUST be refused when the listing isn't active (sold, filled,
  withdrawn, expired, hidden), when the requester owns it, when either party has blocked the
  other, or when the owner can't sign in. The member MUST be told which of these applies in
  plain language, except blocking, which reads as "this listing can't receive requests".
- **FR-004**: A message MUST be 1–4000 characters after trimming (the existing limit messages already have; planning, research R7).
- **FR-005**: Neither the request flow nor any email MUST reveal either party's email address
  or phone number (as 008 FR-026 already requires).

**Email**

- **FR-006**: When a message is saved, the other participant in the conversation MUST be
  emailed: the owner for a request, the requester for the owner's reply, and so on for every
  message (subject to FR-009 and FR-010).
- **FR-007**: An email MUST name the listing, the sender's display name and the message text,
  and MUST link to that conversation in the console. Like every email the platform sends, it MUST
  contain the text in German and then in English. Members have no stored language to choose by
  (planning, research R5).
- **FR-008**: The message MUST be saved before any email is attempted. An email failure MUST
  NOT fail or undo the message. Failed emails MUST be retried.
- **FR-009**: Messages arriving in the same conversation within 15 minutes MUST be combined into
  a single email to each recipient.
- **FR-010**: No email MUST be sent to an account that can't sign in, has no email address, or
  whose address is suppressed after bounces.

**Messages area**

- **FR-011**: Members MUST have a Messages area on the web console and in the app that lists
  their conversations, newest activity first, with the listing title, the other person's
  display name, the latest message, its time, and a "new" marker for conversations with
  messages they haven't opened.
- **FR-012**: A member MUST be able to open a conversation, read all its messages in order and
  reply, including after the listing has closed.
- **FR-013**: Replies MUST be made in the console or the app. Emails MUST come from an address
  that accepts no replies, and MUST say so with the link to the conversation.
- **FR-014**: A conversation MUST be visible only to its two participants. Anyone else MUST get
  the same answer as for a conversation that doesn't exist.
- **FR-015**: Every interface string MUST exist in German and English on both the web console
  and the app.

### Key Entities

- **Conversation** *(exists, from 008)*: two members and the listing it's about. At most one per
  requester per listing.
- **Message** *(exists, from 008)*: one entry in a conversation: sender, text, time. It's saved
  before anyone is notified.
- **Read position** *(new)*: per member per conversation, the latest message they've seen. It's
  what makes "new" markers possible.
- **Message email** *(new)*: one pending or sent notification email per recipient per
  conversation per 15-minute window, with its delivery state. It goes through the platform's
  existing mail outbox.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From a listing, a member can send a request in under 30 seconds, in three steps or
  fewer (open the listing, write, send).
- **SC-002**: 100% of saved requests produce an email to the owner (when FR-010 allows one), and
  95% of those leave the platform within 2 minutes.
- **SC-003**: 0 messages are lost when email delivery is down. Every request sent during an
  email outage is visible in Messages, and its email goes out once delivery recovers.
- **SC-004**: No email or response in this feature contains either party's email address or
  phone number.
- **SC-005**: A burst of 10 messages in one conversation within 15 minutes produces at most one
  email per recipient.
- **SC-006**: An owner can go from the email to replying in under 1 minute.

## Assumptions

- **No push notifications in this feature.** Email is what was asked for. A push for a new
  message can use the same moment later.
- **Requests are members-only**, as the marketplace is: organisation users and staff don't send
  requests. Staff moderation of listings (008) is unchanged and doesn't read conversations.
- **Emails can't be switched off yet.** They're transactional (someone wrote to you about your
  listing). A per-member email setting is a natural follow-up, alongside the privacy settings
  the business description lists.
- **No real-time delivery.** A reply shows up when Messages is opened or refreshed, as in 008.
  "Updated by email" is the timely channel.
- **No attachments.** Requests and replies are plain text.
- **Existing rules carry over unchanged**: the message flood limit, the one-conversation-per-
  member-per-listing rule, and refusing inquiries on closed listings (008 FR-027).
