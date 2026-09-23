import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Conversation persistence (US5, FR-025, FR-026).
 *
 * The substrate, not the transport. Real-time delivery is additive and lands
 * later; what this module guarantees is that a message is **in the database
 * before anyone is told about it**, which is the ordering the Technology &
 * Security Baseline states and the reason a dropped connection cannot lose
 * data.
 *
 * **Every query names its columns.** `conversations` joins to `members`, so a
 * `SELECT *` here would put an email address and a mobile number into a
 * response the moment someone added a column — which is precisely FR-026's
 * failure mode. `tests/messaging/no-select-star.test.ts` enforces it.
 */

/**
 * The columns a conversation response may carry.
 *
 * Display identity only. `m.email` and `m.mobile` are on the same row and are
 * deliberately absent: this is the payload where the explicit-columns rule is
 * load-bearing, because it already carries two members' data.
 */
const PARTICIPANT_COLUMNS = `
  p.member_id, p.last_read_at, p.joined_at,
  m.display_name AS participant_display_name, m.status AS participant_status
`

const MESSAGE_COLUMNS = `
  msg.id, msg.conversation_id, msg.sender_id, msg.body, msg.created_at
`

/** Raised when the caller is not in the conversation, or it does not exist. */
export class ConversationNotFoundError extends Error {
  constructor() {
    // One message for both cases, on purpose — see `loadParticipation`.
    super('No such conversation.')
    this.name = 'ConversationNotFoundError'
  }
}

/**
 * Assert the caller participates, answering **404 for a non-participant**.
 *
 * Byte-identical to a conversation that does not exist, which is the whole
 * point: a 403 would confirm the id is real, turning id-guessing into
 * discovering who is talking to whom. That is a worse disclosure for private
 * correspondence than it is for a listing, and it is the same reasoning as
 * `guardOrganisationScope`.
 */
async function loadParticipation(
  app: GwcApp,
  { conversationId, memberId, signal }:
    { conversationId: string; memberId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT c.id, c.subject_type, c.subject_id, c.created_at, c.last_message_at
       FROM conversations c
       JOIN conversation_participants p
         ON p.conversation_id = c.id AND p.member_id = $2::uuid
      WHERE c.id = $1::uuid`,
    [conversationId, memberId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw new ConversationNotFoundError()
  return row
}

/**
 * Start a conversation with its participants and opening message, atomically.
 *
 * All of it in one transaction: a conversation with no participants is
 * unreachable by anyone, and a conversation with no opening message is an empty
 * thread in both inboxes. Neither is a state a reader could make sense of.
 */
export async function startConversation(
  app: GwcApp,
  { subjectType, subjectId, participantIds, senderId, body, signal }: {
    subjectType: string
    subjectId: string | null
    participantIds: readonly string[]
    senderId: string
    body: string
    signal?: AbortSignal
  },
) {
  return withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: created } = await client.query(
      `INSERT INTO conversations (subject_type, subject_id, last_message_at)
       VALUES ($1, $2::uuid, now())
       RETURNING id, subject_type, subject_id, created_at, last_message_at`,
      [subjectType, subjectId],
    )
    const conversation = created[0]!

    // Distinct, because the sender is also a participant and a duplicate would
    // violate the composite primary key rather than being ignored.
    for (const memberId of new Set(participantIds)) {
      await client.query(
        `INSERT INTO conversation_participants (conversation_id, member_id)
         VALUES ($1::uuid, $2::uuid) ON CONFLICT DO NOTHING`,
        [conversation.id, memberId],
      )
    }

    const { rows: messages } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1::uuid, $2::uuid, $3)
       RETURNING id, conversation_id, sender_id, body, created_at`,
      [conversation.id, senderId, body],
    )

    return { conversation, message: messages[0]! }
  }, { signal })
}

/**
 * Append a message to a conversation the caller participates in.
 *
 * Returns before anything is notified. Notification is the caller's next step,
 * deliberately outside this function and outside its transaction — see
 * `notifyAfterCommit`.
 */
export async function appendMessage(
  app: GwcApp,
  { conversationId, senderId, body, signal }:
    { conversationId: string; senderId: string; body: string; signal?: AbortSignal },
) {
  return withTransaction(app.pg, async (client: PoolClient) => {
    // Re-checked inside the transaction rather than trusting a prior read: the
    // participation could have changed between the two, and this is the check
    // that decides whether a member may write into someone's correspondence.
    const { rows: participates } = await client.query(
      `SELECT 1 FROM conversation_participants
        WHERE conversation_id = $1::uuid AND member_id = $2::uuid`,
      [conversationId, senderId],
    )
    if (participates.length === 0) throw new ConversationNotFoundError()

    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_id, body)
       VALUES ($1::uuid, $2::uuid, $3)
       RETURNING id, conversation_id, sender_id, body, created_at`,
      [conversationId, senderId, body],
    )
    const message = rows[0]!

    // T061: the inbox ordering key, maintained on every append. Denormalised
    // because the alternative is a correlated subquery per row on the hottest
    // list query messaging has. Stamped from the message's own timestamp, not
    // a second now(), so the two can never disagree.
    await client.query(
      'UPDATE conversations SET last_message_at = $2 WHERE id = $1::uuid',
      [conversationId, message.created_at],
    )

    return message
  }, { signal })
}

/**
 * Notify after commit — never inside the transaction.
 *
 * A transaction that rolled back because a push failed would lose a message the
 * sender was already told was accepted. That is the data loss the Baseline
 * clause exists to prevent, and it fails *silently*, which is why this is a
 * function of its own with a test that deliberately breaks it
 * (`tests/messaging/persist-before-notify.test.ts`).
 *
 * A failure here is logged and swallowed: the message is already durable, the
 * sender's request has already succeeded, and turning a missed notification
 * into a failed request would report data loss that did not happen.
 */
export async function notifyAfterCommit(
  app: GwcApp,
  { conversationId, messageId, senderId }:
    { conversationId: string; messageId: string; senderId: string },
) {
  try {
    const { rows } = await query(
      app.pg,
      `SELECT p.member_id
         FROM conversation_participants p
        WHERE p.conversation_id = $1::uuid AND p.member_id <> $2::uuid`,
      [conversationId, senderId],
    )
    await app.notifyMessage?.({
      conversationId,
      messageId,
      recipientIds: rows.map((r) => String(r.member_id)),
    })
  } catch (err) {
    app.log.warn({ err, conversationId, messageId }, 'message notification failed after commit')
  }
}

/** The inbox: every conversation this member is in, newest activity first. */
export async function listConversations(
  app: GwcApp,
  { memberId, limit, cursor, signal }: {
    memberId: string
    limit: number
    cursor?: { lastMessageAt: string; id: string } | null
    signal?: AbortSignal
  },
) {
  const params: unknown[] = [memberId]
  let keyset = ''
  if (cursor) {
    params.push(cursor.lastMessageAt, cursor.id)
    keyset = `AND (c.last_message_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
  }
  params.push(limit + 1)

  const { rows } = await query(
    app.pg,
    `SELECT c.id, c.subject_type, c.subject_id, c.created_at, c.last_message_at,
            p.last_read_at,
            (SELECT count(*) FROM messages m2
              WHERE m2.conversation_id = c.id
                AND (p.last_read_at IS NULL OR m2.created_at > p.last_read_at)
                AND m2.sender_id <> $1::uuid) AS unread_count
       FROM conversations c
       JOIN conversation_participants p
         ON p.conversation_id = c.id AND p.member_id = $1::uuid
      WHERE true ${keyset}
      ORDER BY c.last_message_at DESC, c.id DESC
      LIMIT $${params.length}`,
    params,
    { signal },
  )

  const hasMore = rows.length > limit
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore }
}

/** One conversation and a page of its messages, newest first. */
export async function readConversation(
  app: GwcApp,
  { conversationId, memberId, limit, cursor, signal }: {
    conversationId: string
    memberId: string
    limit: number
    cursor?: { createdAt: string; id: string } | null
    signal?: AbortSignal
  },
) {
  const conversation = await loadParticipation(app, { conversationId, memberId, signal })

  const { rows: participants } = await query(
    app.pg,
    `SELECT ${PARTICIPANT_COLUMNS}
       FROM conversation_participants p
       JOIN members m ON m.id = p.member_id
      WHERE p.conversation_id = $1::uuid
      ORDER BY p.joined_at, p.member_id`,
    [conversationId],
    { signal },
  )

  const params: unknown[] = [conversationId]
  let keyset = ''
  if (cursor) {
    params.push(cursor.createdAt, cursor.id)
    keyset = `AND (msg.created_at, msg.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
  }
  params.push(limit + 1)

  const { rows: messages } = await query(
    app.pg,
    `SELECT ${MESSAGE_COLUMNS}
       FROM messages msg
      WHERE msg.conversation_id = $1::uuid ${keyset}
      ORDER BY msg.created_at DESC, msg.id DESC
      LIMIT $${params.length}`,
    params,
    { signal },
  )

  const hasMore = messages.length > limit
  return {
    conversation,
    participants,
    messages: hasMore ? messages.slice(0, limit) : messages,
    hasMore,
  }
}

/**
 * Mark the caller's participation read up to now.
 *
 * This is what "delivery is on read" means in practice: there is no
 * `delivered_at` anywhere, and `last_read_at` is set by the act of reading
 * rather than by a transport reporting it.
 */
export async function markRead(
  app: GwcApp,
  { conversationId, memberId, signal }:
    { conversationId: string; memberId: string; signal?: AbortSignal },
) {
  await query(
    app.pg,
    `UPDATE conversation_participants SET last_read_at = now()
      WHERE conversation_id = $1::uuid AND member_id = $2::uuid`,
    [conversationId, memberId],
    { signal },
  )
}

export { forbidden, PROBLEMS }
