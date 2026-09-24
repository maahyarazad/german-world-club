import { createHash } from 'node:crypto'
import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { AUDIENCE_FOR_KIND } from './audience.ts'
import type { Notification, LocalizedText, Destination } from '@gwc/contracts/push'
import type { GwcApp } from '../../../app.ts'

/**
 * Queue a staff notification (feature 011, research R1, R2).
 *
 * The request that calls this sends nothing. It inserts one `push_notifications`
 * row and returns; the `push.deliver` job does the sending. That is what makes
 * persist-before-notify true for push, keeps provider calls out of every route
 * budget, and lets a 5,000-device broadcast take the ten minutes it needs.
 *
 * **Idempotent on `clientRef`** (Principle IV). The console makes a new ref
 * when the form opens and after every accepted send, so:
 *   - the same ref with the same content is a retry → the existing row, `created: false`
 *   - the same ref with *different* content is a new message under a stale ref
 *     → `push/idempotency-conflict`. Answering it with the earlier notification
 *     would silently drop what staff just wrote.
 */

type StaffKind = 'rehearsal' | 'broadcast'

/** Exactly the columns the history shows. Named, never `*` (CLAUDE.md). */
export const NOTIFICATION_COLUMNS = `
  n.id, n.kind, n.status, n.created_at, n.sent_at, n.finished_at,
  n.title_de, n.body_de, n.title_en, n.body_en,
  n.destination_type, n.destination_id, n.destination_label,
  n.sent_by, sb.display_name AS sent_by_name,
  COALESCE(t.pending, 0) AS pending, COALESCE(t.sent, 0) AS sent,
  COALESCE(t.delivered, 0) AS delivered, COALESCE(t.failed, 0) AS failed,
  COALESCE(t.skipped, 0) AS skipped`

/**
 * The joins `NOTIFICATION_COLUMNS` needs. Totals are counted live from the
 * deliveries rather than read from the stored totals, because a receipt can
 * turn a `sent` into a `failed` after the notification finished.
 */
export const NOTIFICATION_JOINS = `
  LEFT JOIN admin_users sb ON sb.id = n.sent_by
  LEFT JOIN LATERAL (
    SELECT count(*) FILTER (WHERE status IN ('pending', 'sending'))::int AS pending,
           count(*) FILTER (WHERE status = 'sent')::int                  AS sent,
           count(*) FILTER (WHERE status = 'delivered')::int             AS delivered,
           count(*) FILTER (WHERE status = 'failed')::int                AS failed,
           count(*) FILTER (WHERE status = 'skipped')::int               AS skipped
      FROM push_deliveries WHERE notification_id = n.id
  ) t ON true`

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null)

export function toNotification(row: Record<string, any>): Notification {
  const text = (title: unknown, body: unknown) =>
    title === null || body === null ? null : { title: String(title), body: String(body) }
  return {
    id: String(row.id),
    kind: row.kind,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    sentAt: iso(row.sent_at),
    finishedAt: iso(row.finished_at),
    de: text(row.title_de, row.body_de),
    en: text(row.title_en, row.body_en),
    destination: row.destination_type
      ? { type: row.destination_type, id: String(row.destination_id ?? ''), label: row.destination_label ?? null }
      : null,
    sentBy: row.sent_by ? { id: String(row.sent_by), displayName: row.sent_by_name ?? null } : null,
    totals: {
      pending: row.pending, sent: row.sent, delivered: row.delivered, failed: row.failed, skipped: row.skipped,
    },
  }
}

/**
 * sha256 over a canonical rendering of what the member would see.
 *
 * Key order is fixed by construction rather than by JSON.stringify's insertion
 * order, so the same message always hashes the same however the body arrived.
 */
export function payloadHash({ kind, de, en, destination }: {
  kind: StaffKind; de: LocalizedText; en: LocalizedText; destination: Destination | null
}) {
  const canonical = JSON.stringify([
    kind,
    [de.title, de.body],
    [en.title, en.body],
    destination ? [destination.type, destination.id ?? '', destination.label ?? null] : null,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

async function load(app: GwcApp, where: string, value: string, signal?: AbortSignal) {
  const { rows } = await app.pg.query(
    `SELECT ${NOTIFICATION_COLUMNS}, n.payload_hash
       FROM push_notifications n
       ${NOTIFICATION_JOINS}
      WHERE ${where} = $1`,
    [value],
  )
  if (signal?.aborted) throw signal.reason ?? new Error('aborted')
  return rows[0] ?? null
}

export type EnqueueInput = {
  kind: StaffKind
  clientRef: string
  de: LocalizedText
  en: LocalizedText
  destination?: Destination
  principal: { id: string; kind?: string }
  requestId: string
  signal?: AbortSignal
}

export async function enqueueNotification(app: GwcApp, input: EnqueueInput) {
  const { kind, clientRef, de, en, principal, requestId, signal } = input
  // 'none' is the absence of a destination, not a destination.
  const destination = input.destination && input.destination.type !== 'none' ? input.destination : null
  const hash = payloadHash({ kind, de, en, destination })

  const existing = await load(app, 'n.idempotency_key', clientRef, signal)
  if (existing) return resolveRepeat(existing, hash)

  if (kind === 'rehearsal') {
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM push_test_recipients')
    if (rows[0].n === 0) {
      throw refuse(PROBLEMS.PUSH_NO_TEST_RECIPIENTS, 'Add at least one test user before rehearsing.')
    }
  }

  const { rows: inserted } = await app.pg.query(
    `INSERT INTO push_notifications
       (kind, audience, idempotency_key, payload_hash,
        title_de, body_de, title_en, body_en,
        destination_type, destination_id, destination_label, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      kind, AUDIENCE_FOR_KIND[kind], clientRef, hash,
      de.title, de.body, en.title, en.body,
      destination?.type ?? null, destination ? destination.id ?? '' : null, destination?.label ?? null,
      principal.id,
    ],
  )

  // Lost a race with a concurrent request carrying the same ref: that one
  // created the row, and this one is its repeat.
  if (inserted.length === 0) {
    const raced = await load(app, 'n.idempotency_key', clientRef)
    return resolveRepeat(raced, hash)
  }

  const id = String(inserted[0].id)
  await app.audit({
    action: kind === 'rehearsal' ? 'push_rehearsal_queued' : 'push_broadcast_queued',
    outcome: 'allowed',
    requestId,
    actorId: principal.id,
    actorKind: principal.kind,
    targetType: 'push_notification',
    targetId: id,
    requiredPermission: 'mass_messages.write',
    detail: { destination: destination?.type ?? null },
  })

  const notification = toNotification(await load(app, 'n.id', id))

  // After the insert has committed — a plain pool query autocommits — so the
  // job the kick starts can see the row (research R1). Last, so nothing the
  // response still needs is waiting behind the dispatcher.
  await kickDispatch(app)

  return { notification, created: true }
}

function resolveRepeat(row: Record<string, any> | null, hash: string) {
  if (!row) throw new Error('idempotency key vanished between insert and read')
  if (row.payload_hash !== hash) {
    throw refuse(
      PROBLEMS.PUSH_IDEMPOTENCY_CONFLICT,
      'This reference was already used for a different message. Send again to queue it as a new one.',
    )
  }
  return { notification: toNotification(row), created: false }
}

/**
 * Ask pg-boss to run `push.deliver` now instead of at the next minute (SC-001).
 *
 * Carries no notification id: the job it triggers sends everything that is
 * due. Best-effort — a lost kick costs at most a minute, because the cron tick
 * sweeps the same queue — so a failure is logged and never fails the request
 * that already queued the notification.
 */
export async function kickDispatch(app: GwcApp) {
  try {
    await app.boss.send('push.dispatch', {}, { singletonKey: 'push.dispatch' })
  } catch (err) {
    app.log.warn({ err }, 'push dispatch kick failed; the next push.deliver tick will send')
  }
}
