import { PROBLEMS } from '@gwc/contracts/errors'
import {
  listConversations, readConversation, appendMessage, markRead, notifyAfterCommit,
  ConversationNotFoundError,
} from './application/converse.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Request and reply shaping for messaging. Every rule lives in `application/`.
 *
 * The shaping itself is load-bearing here in a way it usually is not: this is
 * where a conversation's rows become a response, and FR-026 says no response
 * may carry an email address or a phone number for either party. The
 * application layer names its columns so those values are never loaded; the
 * mappers below name their fields so nothing new is emitted by accident.
 */
export function createMessagingController(app: GwcApp) {
  return {
    inbox: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const q = (request.query ?? {}) as Record<string, string>

      const { rows, hasMore } = await listConversations(app, {
        memberId: String(principal.id),
        limit: boundedLimit(q.limit),
        cursor: q.cursor ? decodeInboxCursor(q.cursor) : null,
        signal: request.deadlineSignal,
      })

      const last = rows[rows.length - 1]
      return reply.send({
        items: rows.map(toConversationSummary),
        nextCursor: hasMore && last
          ? encodeCursor(last.last_message_at, String(last.id))
          : null,
      })
    },

    read: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const q = (request.query ?? {}) as Record<string, string>

      try {
        const result = await readConversation(app, {
          conversationId: id,
          memberId: String(principal.id),
          limit: boundedLimit(q.limit),
          cursor: q.cursor ? decodeMessageCursor(q.cursor) : null,
          signal: request.deadlineSignal,
        })

        // Delivery is on read — there is no transport to report it, so reading
        // is what records it. After the response is shaped, so a failure to
        // record it cannot cost the caller the messages themselves.
        await markRead(app, {
          conversationId: id,
          memberId: String(principal.id),
          signal: request.deadlineSignal,
        })

        const last = result.messages[result.messages.length - 1]
        return reply.send({
          conversation: toConversationSummary(result.conversation),
          participants: result.participants.map(toParticipant),
          messages: result.messages.map(toMessage),
          nextCursor: result.hasMore && last
            ? encodeCursor(last.created_at, String(last.id))
            : null,
        })
      } catch (err) {
        return notFoundOrThrow(err, request, reply)
      }
    },

    reply: async (request: GwcRequest, reply: GwcReply) => {
      const principal = request.principal!
      const { id } = request.params as { id: string }
      const { body } = request.body as { body: string }

      try {
        const message = await appendMessage(app, {
          conversationId: id,
          senderId: String(principal.id),
          body,
          signal: request.deadlineSignal,
        })

        // Committed. Only now is anyone told — see notifyAfterCommit.
        await notifyAfterCommit(app, {
          conversationId: id,
          messageId: String(message.id),
          senderId: String(principal.id),
        })

        return reply.code(201).send(toMessage(message))
      } catch (err) {
        return notFoundOrThrow(err, request, reply)
      }
    },
  }
}

/**
 * A non-participant and a conversation that does not exist get the same answer.
 *
 * Byte-identical on purpose: anything that distinguished them would let someone
 * guessing ids discover who is talking to whom.
 */
function notFoundOrThrow(err: unknown, request: GwcRequest, reply: GwcReply) {
  if (err instanceof ConversationNotFoundError) {
    return reply.code(PROBLEMS.NOT_FOUND.status).send({
      ...PROBLEMS.NOT_FOUND,
      instance: request.url,
    })
  }
  throw err
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

export const DEFAULT_LIMIT = 30
export const MAX_LIMIT = 100

/**
 * T062 — the second bounded parameter in this feature, and it is bounded the
 * same three ways as the marketplace's.
 *
 * Coerced (so SQL never receives the string "50"), defaulted (so an absent
 * parameter is not `undefined` in a LIMIT) and capped (so `?limit=1000000` is
 * not served). Done here rather than only in the route schema because feature
 * 007 Phase 6 deletes that schema; see modules/marketplace/controller.ts for
 * the full reasoning and tests/marketplace/limit.test.ts for the assertions.
 */
export function boundedLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

export function encodeCursor(at: string | Date, id: string): string {
  return Buffer.from(`${new Date(at).toISOString()}|${id}`).toString('base64url')
}

function decodeCursor(raw: string): { at: string; id: string } {
  const [at, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|')
  if (!at || !id || Number.isNaN(Date.parse(at))) {
    // Unparseable is a refusal, never a silent reset to page one — silently
    // restarting is how a client loops forever without noticing.
    const err = new Error('Malformed cursor.')
    err.name = 'MalformedCursorError'
    throw err
  }
  return { at, id }
}

const decodeInboxCursor = (raw: string) => {
  const { at, id } = decodeCursor(raw)
  return { lastMessageAt: at, id }
}

const decodeMessageCursor = (raw: string) => {
  const { at, id } = decodeCursor(raw)
  return { createdAt: at, id }
}

// ---------------------------------------------------------------------------
// Response shaping — named fields only (FR-026)
// ---------------------------------------------------------------------------

function toConversationSummary(row: Record<string, unknown>) {
  return {
    id: row.id,
    subjectType: row.subject_type,
    subjectId: row.subject_id ?? null,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    ...(row.unread_count === undefined ? {} : { unreadCount: Number(row.unread_count) }),
    ...(row.last_read_at === undefined ? {} : { lastReadAt: row.last_read_at ?? null }),
  }
}

/** Display identity only. No email, no mobile — not even for the caller. */
function toParticipant(row: Record<string, unknown>) {
  return {
    memberId: row.member_id,
    displayName: row.participant_display_name ?? null,
    status: row.participant_status,
    lastReadAt: row.last_read_at ?? null,
  }
}

function toMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
  }
}
