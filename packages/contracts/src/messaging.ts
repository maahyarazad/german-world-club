import { z } from 'zod'

/**
 * Messaging — persistence and the marketplace inquiry flow (feature 008),
 * with the shapes the Messages screens read (feature 020, research R8).
 *
 * Deliberately narrow: a conversation, its participants, its messages. Group
 * conversations, typing state, read receipts and §7's notification opt-in
 * matrix are a later feature, and a shape that pretended to model them would
 * be guessing at something nobody has specified.
 *
 * No field here carries an email address or a phone number, for either party
 * (FR-026). The listing stores a contact preference; the conversation is how
 * that preference is honoured. Names are display identity only.
 */

/** The same bound as the `messages_body_bounded` CHECK in 018_messaging.sql. */
export const MESSAGE_MAX = 4000

const iso = z.string()

/** What a conversation is about. `marketplace_listing` today; threads later. */
export const conversationSubjectSchema = z.object({
  type: z.literal('marketplace_listing'),
  id: z.string().uuid().nullable(),
  /** The listing's title now, or `null` when the listing no longer exists. */
  title: z.string().nullable(),
})

/** The other person in a two-person conversation. Display identity only. */
export const counterpartSchema = z.object({
  memberId: z.string().uuid(),
  displayName: z.string().nullable(),
  handle: z.string().nullable(),
})

export const lastMessageSchema = z.object({
  senderId: z.string().uuid(),
  /** The first 140 characters. */
  excerpt: z.string(),
  createdAt: iso,
})

export const conversationSchema = z.object({
  id: z.string().uuid(),
  subject: conversationSubjectSchema,
  counterpart: counterpartSchema.nullable(),
  lastMessage: lastMessageSchema.nullable(),
  createdAt: iso,
  /** The inbox ordering key. */
  lastMessageAt: iso,
  /** Messages from the other side newer than the caller's last read; not a read receipt. */
  unreadCount: z.number().int(),
})

export const participantSchema = z.object({
  memberId: z.string().uuid(),
  displayName: z.string().nullable(),
  status: z.string(),
  lastReadAt: iso.nullable(),
})

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderId: z.string().uuid(),
  body: z.string(),
  createdAt: iso,
})

export const inboxPageSchema = z.object({
  items: z.array(conversationSchema),
  nextCursor: z.string().nullable(),
})

/** One conversation and a page of its messages, newest first. */
export const conversationViewSchema = z.object({
  conversation: conversationSchema,
  participants: z.array(participantSchema),
  messages: z.array(messageSchema),
  nextCursor: z.string().nullable(),
})

export const sendMessageRequestSchema = z.object({ body: z.string().trim().min(1).max(MESSAGE_MAX) })

/** Starting — or continuing — a conversation from a listing. */
export const inquireRequestSchema = sendMessageRequestSchema

export const inquireResponseSchema = z.object({
  conversationId: z.string().uuid(),
  /** False when the request was added to an existing conversation about this listing. */
  created: z.boolean(),
  message: messageSchema,
})

export type ConversationSubject = z.infer<typeof conversationSubjectSchema>
export type Counterpart = z.infer<typeof counterpartSchema>
export type LastMessage = z.infer<typeof lastMessageSchema>
export type Conversation = z.infer<typeof conversationSchema>
export type Participant = z.infer<typeof participantSchema>
export type Message = z.infer<typeof messageSchema>
export type InboxPage = z.infer<typeof inboxPageSchema>
export type ConversationView = z.infer<typeof conversationViewSchema>
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>
export type InquireRequest = z.infer<typeof inquireRequestSchema>
export type InquireResponse = z.infer<typeof inquireResponseSchema>
