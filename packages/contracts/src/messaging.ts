/**
 * Messaging — persistence and the marketplace inquiry flow (feature 008).
 *
 * Deliberately narrow: a conversation, its participants, its messages. Group
 * conversations, typing state, read receipts and §7's notification opt-in
 * matrix are a later feature, and a shape that pretended to model them would
 * be guessing at something nobody has specified.
 *
 * No field here carries an email address or a phone number, for either party
 * (FR-026). The listing stores a contact preference; the conversation is how
 * that preference is honoured.
 */

/** What a conversation is about. `marketplace_listing` today; threads later. */
export type ConversationSubject = {
  type: 'marketplace_listing'
  id: string
}

/** Display identity only. */
export type Participant = {
  memberId: string
  displayName: string
}

export type Message = {
  id: string
  conversationId: string
  senderId: string
  body: string
  createdAt: string
}

export type Conversation = {
  id: string
  subject: ConversationSubject
  participants: readonly Participant[]
  /** The inbox ordering key. */
  lastMessageAt: string
  /** Computed from the caller's `last_read_at`; not a read receipt. */
  unreadCount: number
}

export type ConversationPage = {
  items: readonly Message[]
  nextCursor: string | null
}

export type SendMessageRequest = { body: string }

/** Starting a conversation from a listing. */
export type InquireRequest = { body: string }

export type InquireResponse = { conversationId: string; message: Message }
