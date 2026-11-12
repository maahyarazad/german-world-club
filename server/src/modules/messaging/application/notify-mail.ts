import { withTransaction } from '../../../db/query.ts'
import { messageId as outboxMessageId } from '../../../integrations/mail.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * Emailing the other participant about a new message (feature 020, US2).
 *
 * Installed as `app.notifyMessage`, which `notifyAfterCommit` calls once the
 * message is committed and whose failures it swallows — so a message is saved
 * before any email is attempted, and no email problem can undo it (FR-008).
 *
 * One email per recipient per conversation per 15 minutes, and nothing dropped
 * (research R3). For each recipient, under a row lock on their schedule row:
 *
 *   - an email still WAITING (unsent, and not yet picked up by mail.deliver)
 *     absorbs the message: count + 1, latest three kept;
 *   - otherwise a new email is scheduled for
 *     max(now + 60 s, previous scheduled time + 15 min).
 *
 * The 60 seconds let a quick back-and-forth land in one email. "Waiting" means
 * `next_attempt_at` still equals the time this module scheduled it for: the
 * delivery job's lease moves it, and merging into an email that is being sent
 * would put a message into variables about to be cleared — never emailed.
 */

export const MESSAGE_TEMPLATE = 'messaging.new-message'
/** How many messages one email quotes, newest first. */
const QUOTED = 3
const BODY_MAX = 500

type Event = { conversationId: string; messageId: string; recipientIds: readonly string[] }

export async function scheduleMessageMail(app: GwcApp, event: Event) {
  for (const recipientId of event.recipientIds) {
    await withTransaction(app.pg, (client) => scheduleFor(app, client, event, recipientId))
  }
}

async function scheduleFor(app: GwcApp, client: PoolClient, { conversationId, messageId }: Event, recipientId: string) {
  // Everything the email needs and everything that rules it out, in one read.
  // Names only — never the sender's email or mobile (FR-005).
  const { rows: [facts] } = await client.query(
    `SELECT r.status, r.email::text AS email, r.email_suppressed, r.display_name AS recipient_name,
            s.display_name AS sender_name, msg.body, msg.created_at,
            (SELECT l.title FROM conversations c
               JOIN marketplace_listings l ON c.subject_type = 'marketplace_listing' AND l.id = c.subject_id
              WHERE c.id = msg.conversation_id) AS listing_title,
            EXISTS (SELECT 1 FROM member_blocks b
                     WHERE (b.blocker_id = r.id AND b.blocked_id = s.id)
                        OR (b.blocker_id = s.id AND b.blocked_id = r.id)) AS blocked
       FROM messages msg
       JOIN members s ON s.id = msg.sender_id
       JOIN members r ON r.id = $2::uuid
      WHERE msg.id = $1::uuid AND msg.conversation_id = $3::uuid`,
    [messageId, recipientId, conversationId],
  )
  // Not reachable, or should not be reached (research R4, FR-010).
  if (!facts || facts.status !== 'active' || !facts.email || facts.email_suppressed || facts.blocked) return

  const quoted = {
    senderName: facts.sender_name ?? '',
    body: String(facts.body).slice(0, BODY_MAX),
    at: new Date(facts.created_at).toISOString(),
  }

  await client.query(
    `INSERT INTO message_mail_schedule (conversation_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [conversationId, recipientId],
  )
  // The lock that makes "one email per window" hold under concurrency.
  await client.query(
    'SELECT 1 FROM message_mail_schedule WHERE conversation_id = $1 AND member_id = $2 FOR UPDATE',
    [conversationId, recipientId],
  )

  const { rows: [waiting] } = await client.query(
    `SELECT o.id, o.variables
       FROM message_mail_schedule s
       JOIN mail_outbox o ON o.message_id = s.pending_message_id
      WHERE s.conversation_id = $1 AND s.member_id = $2
        AND o.sent_at IS NULL AND o.next_attempt_at = s.last_scheduled_for
      FOR UPDATE OF o`,
    [conversationId, recipientId],
  )

  if (waiting) {
    const previous = waiting.variables as { count?: number; messages?: unknown[] }
    await client.query('UPDATE mail_outbox SET variables = $2 WHERE id = $1', [
      waiting.id,
      JSON.stringify({
        ...previous,
        count: Number(previous.count ?? 0) + 1,
        messages: [quoted, ...(previous.messages ?? [])].slice(0, QUOTED),
      }),
    ])
    return
  }

  const variables = {
    recipientName: facts.recipient_name ?? '',
    listingTitle: facts.listing_title ?? '',
    conversationId,
    count: 1,
    messages: [quoted],
  }
  // Keyed on the message that opened this email, so a retried notification for
  // the same message lands on the same outbox row instead of a second email.
  const id = outboxMessageId({ to: facts.email, template: MESSAGE_TEMPLATE, subjectKey: `${conversationId}:${recipientId}:${messageId}` })

  // One statement: the outbox row and the schedule row get the SAME timestamp,
  // which the equality test above depends on (see 041_message_mail.sql).
  await client.query(
    `WITH ins AS (
       INSERT INTO mail_outbox (message_id, to_address, template, variables, next_attempt_at)
       SELECT $1, $2, $3, $4::jsonb,
              greatest(now() + interval '60 seconds',
                       coalesce(s.last_scheduled_for, '-infinity'::timestamptz) + interval '15 minutes')
         FROM message_mail_schedule s
        WHERE s.conversation_id = $5 AND s.member_id = $6
       ON CONFLICT (message_id) DO NOTHING
       RETURNING message_id, next_attempt_at)
     UPDATE message_mail_schedule s
        SET pending_message_id = ins.message_id, last_scheduled_for = ins.next_attempt_at
       FROM ins
      WHERE s.conversation_id = $5 AND s.member_id = $6`,
    [id, facts.email, MESSAGE_TEMPLATE, JSON.stringify(variables), conversationId, recipientId],
  )

  // The same bargain enqueueMail makes: on a laptop there is no mail server, so
  // the content is logged to let the flow be followed. Never anywhere real.
  if (app.env.NODE_ENV === 'development') {
    app.log.info({ to: facts.email, template: MESSAGE_TEMPLATE, variables }, 'mail queued (development: contents logged)')
  }
}
