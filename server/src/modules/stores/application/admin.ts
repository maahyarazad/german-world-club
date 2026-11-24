import { PROBLEMS } from '@gwc/contracts/errors'
import type { AdminStore } from '@gwc/contracts/stores'
import { withTransaction, query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Staff control of merchant stores (feature 035, research R2).
 *
 * Switching a store off hides it and every one of its offers from every user on
 * the NEXT request — visibility is read from the store row, not cached — and
 * refuses redemption, while its data, media and redemption history stay. The
 * merchant still sees their own store, with a notice, and cannot publish.
 */

const toAdminStore = (row: Record<string, any>): AdminStore => ({
  id: String(row.id),
  organisationId: String(row.organisation_id),
  displayName: row.display_name ?? null,
  slug: String(row.slug),
  active: Boolean(row.active),
  deactivatedAt: row.deactivated_at ? new Date(row.deactivated_at).toISOString() : null,
  deactivationReason: row.deactivation_reason ?? null,
  offerCount: Number(row.offer_count ?? 0),
})

const STORE_COLUMNS = `s.id, s.organisation_id, op.display_name, org.slug, s.active, s.deactivated_at, s.deactivation_reason,
       (SELECT count(*)::int FROM offers o WHERE o.store_id = s.id) AS offer_count`

export async function listStores(app: GwcApp, { signal }: { signal?: AbortSignal } = {}) {
  const { rows } = await query(
    app.pg,
    `SELECT ${STORE_COLUMNS}
       FROM stores s
       JOIN organisations org ON org.id = s.organisation_id
       LEFT JOIN organisation_profiles op ON op.organisation_id = s.organisation_id
      ORDER BY org.slug, s.id`,
    [],
    { signal },
  )
  return { items: rows.map(toAdminStore) }
}

type Actor = { id: string; requestId: string }

/**
 * Set the active flag. Idempotent: setting what is already set changes nothing
 * and writes nothing. A reason is required to switch a store OFF, because an
 * unexplained deactivation cannot be answered for later.
 */
export async function setStoreActive(
  app: GwcApp,
  { storeId, active, reason, actor }: { storeId: string; active: boolean; reason?: string; actor: Actor },
): Promise<AdminStore> {
  if (!active && !reason) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, 'A reason is required to deactivate a store.')
  }
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query('SELECT id, active FROM stores WHERE id = $1 FOR UPDATE', [storeId])
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such store.')

    if (Boolean(rows[0].active) !== active) {
      if (active) {
        await client.query(
          `UPDATE stores SET active = true, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL WHERE id = $1`,
          [storeId],
        )
      } else {
        await client.query(
          `UPDATE stores SET active = false, deactivated_at = now(), deactivated_by = $2, deactivation_reason = $3 WHERE id = $1`,
          [storeId, actor.id, reason],
        )
      }
      await auditInTransaction(client, {
        action: active ? 'store_reactivated' : 'store_deactivated', outcome: 'allowed', requestId: actor.requestId,
        actorId: actor.id, actorKind: 'admin', targetType: 'store', targetId: storeId,
        detail: { storeChange: { before: { active: !active }, after: { active } } },
      })
    }

    const { rows: fresh } = await client.query(
      `SELECT ${STORE_COLUMNS}
         FROM stores s
         JOIN organisations org ON org.id = s.organisation_id
         LEFT JOIN organisation_profiles op ON op.organisation_id = s.organisation_id
        WHERE s.id = $1`,
      [storeId],
    )
    return toAdminStore(fresh[0])
  })
}
