import { query } from '../../../db/query.ts'
import { startConversation, appendMessage } from './converse.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The marketplace inquiry (US5, FR-025, FR-027).
 *
 * The bridge between a listing and a conversation. It lives in `messaging`
 * rather than `marketplace` because what it produces is a conversation, and
 * messaging owns those — the marketplace only supplies the subject and the
 * guard.
 */

/** The `subject_type` marketplace conversations carry. A soft reference (see 018). */
export const MARKETPLACE_SUBJECT = 'marketplace_listing'

/**
 * States that accept a new inquiry.
 *
 * Everything else — withdrawn, sold, filled, expired, hidden, draft — refuses
 * NEW inquiries while leaving existing conversations readable (FR-027). Two
 * people mid-negotiation when the seller marks something sold must not lose the
 * thread, and a conversation that vanished would take the record of what was
 * agreed with it.
 */
const INQUIRABLE_STATES = Object.freeze(['active'])

export class ListingNotInquirableError extends Error {
  readonly state: string
  constructor(state: string) {
    super(`This listing is ${state} and is not accepting new enquiries.`)
    this.name = 'ListingNotInquirableError'
    this.state = state
  }
}

export class SelfInquiryError extends Error {
  constructor() {
    super('You cannot enquire about your own listing.')
    this.name = 'SelfInquiryError'
  }
}

export class ListingNotFoundError extends Error {
  constructor() {
    super('No such listing.')
    this.name = 'ListingNotFoundError'
  }
}

/**
 * Start — or return — the conversation between this member and a listing's
 * owner about that listing.
 *
 * Idempotent per (listing, inquirer): a second inquiry appends to the existing
 * thread instead of opening a parallel one. Two threads about one listing
 * between the same two people is a split conversation where each party sees
 * half of what was said.
 */
export async function inquire(
  app: GwcApp,
  { listingId, inquirerId, body, signal }: {
    listingId: string
    inquirerId: string
    body: string
    signal?: AbortSignal
  },
) {
  // Columns named, never `*` — this row is joined to `members` below and the
  // listing carries the owner's id.
  const { rows } = await query(
    app.pg,
    `SELECT l.id, l.owner_id, l.state, l.contact_method, l.title
       FROM marketplace_listings l
      WHERE l.id = $1::uuid`,
    [listingId],
    { signal },
  )
  const listing = rows[0]
  if (!listing) throw new ListingNotFoundError()

  const ownerId = String(listing.owner_id)
  // Checked before the state: telling someone their own withdrawn listing is
  // "not accepting enquiries" is a confusing answer to a nonsensical request.
  if (ownerId === inquirerId) throw new SelfInquiryError()

  if (!INQUIRABLE_STATES.includes(String(listing.state))) {
    throw new ListingNotInquirableError(String(listing.state))
  }

  // An owner whose standing has lapsed cannot be contacted through their
  // listings either — the same live check the index applies (008 research R7),
  // rather than a denormalised copy.
  const { rows: owners } = await query(
    app.pg,
    'SELECT id, status FROM members WHERE id = $1::uuid',
    [ownerId],
    { signal },
  )
  if (owners[0]?.status !== 'active') throw new ListingNotInquirableError('unavailable')

  const { rows: existing } = await query(
    app.pg,
    `SELECT c.id
       FROM conversations c
       JOIN conversation_participants mine
         ON mine.conversation_id = c.id AND mine.member_id = $2::uuid
       JOIN conversation_participants theirs
         ON theirs.conversation_id = c.id AND theirs.member_id = $3::uuid
      WHERE c.subject_type = $4 AND c.subject_id = $1::uuid
      LIMIT 1`,
    [listingId, inquirerId, ownerId, MARKETPLACE_SUBJECT],
    { signal },
  )

  if (existing[0]) {
    const message = await appendMessage(app, {
      conversationId: String(existing[0].id),
      senderId: inquirerId,
      body,
      signal,
    })
    return { conversationId: String(existing[0].id), message, created: false }
  }

  const { conversation, message } = await startConversation(app, {
    subjectType: MARKETPLACE_SUBJECT,
    subjectId: listingId,
    participantIds: [inquirerId, ownerId],
    senderId: inquirerId,
    body,
    signal,
  })

  return { conversationId: String(conversation.id), message, created: true }
}
