import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { NOTIFICATION_COLUMNS, NOTIFICATION_JOINS, toNotification } from './enqueue.ts'
import type { NotificationKind } from '@gwc/contracts/push'
import type { GwcApp } from '../../../app.ts'

/** The console's history: newest first, optionally one kind. */
export async function listNotifications(
  app: GwcApp,
  { kind, limit, signal }: { kind?: NotificationKind; limit: number; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT ${NOTIFICATION_COLUMNS}
       FROM push_notifications n
       ${NOTIFICATION_JOINS}
      WHERE ($1::push_kind IS NULL OR n.kind = $1)
      ORDER BY n.created_at DESC
      LIMIT $2`,
    [kind ?? null, limit],
    { signal },
  )
  return rows.map(toNotification)
}

/** One notification, for the console to poll while it is sending. */
export async function getNotification(app: GwcApp, { id, signal }: { id: string; signal?: AbortSignal }) {
  const { rows } = await query(
    app.pg,
    `SELECT ${NOTIFICATION_COLUMNS}
       FROM push_notifications n
       ${NOTIFICATION_JOINS}
      WHERE n.id = $1`,
    [id],
    { signal },
  )
  if (!rows[0]) throw refuse(PROBLEMS.NOT_FOUND, 'No such notification.')
  return toNotification(rows[0])
}
