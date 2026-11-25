import { PROBLEMS } from '@gwc/contracts/errors'
import type { Store, CreateStoreRequest, UpdateStoreRequest } from '@gwc/contracts/stores'
import { withTransaction } from '../../../db/query.ts'
import { versionSql } from '../../../db/version.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

/**
 * A merchant's own store (feature 035).
 *
 * One per organisation, held by a UNIQUE constraint rather than by a check here:
 * two simultaneous creates cannot both pass a "does one exist" read, so the
 * database decides and the loser's unique violation becomes `store-exists`.
 *
 * Name and logo are read from `organisation_profiles`, the only member-visible
 * projection of an organisation, so a rename is one change and no contract data
 * (`legal_name`, fee tier) can reach a store payload.
 */

const STORE_SQL = `
  SELECT s.id, s.description, s.opening_hours, s.active, s.cover_asset_id,
         ${versionSql('s')} AS version,
         op.display_name, op.logo_asset_id
    FROM stores s
    LEFT JOIN organisation_profiles op ON op.organisation_id = s.organisation_id
   WHERE s.organisation_id = $1`

/** The store as its own merchant sees it, or null when the organisation has none. */
export async function loadStoreView(db: Queryable, organisationId: string): Promise<Store | null> {
  const { rows } = await db.query(STORE_SQL, [organisationId])
  const row = rows[0]
  if (!row) return null

  const { rows: links } = await db.query(
    'SELECT asset_id FROM store_media WHERE store_id = $1 ORDER BY position', [row.id],
  )
  const wanted = links.map((l) => String(l.asset_id))
  for (const id of [row.cover_asset_id, row.logo_asset_id]) if (id) wanted.push(String(id))
  // Only `ready` assets come back: a file still processing is not delivered, so
  // it is simply absent here until it is.
  const items = await loadMediaItems(db, wanted)

  return {
    id: String(row.id),
    displayName: row.display_name ?? null,
    logo: row.logo_asset_id ? items.get(String(row.logo_asset_id)) ?? null : null,
    description: row.description ?? null,
    cover: row.cover_asset_id ? items.get(String(row.cover_asset_id)) ?? null : null,
    media: links.flatMap((l) => items.get(String(l.asset_id)) ?? []),
    openingHours: row.opening_hours ?? null,
    active: Boolean(row.active),
    // A code, never staff's typed reason: the console translates it.
    deactivationNotice: row.active ? null : 'deactivated',
    version: String(row.version),
  }
}

export async function getOwnStore(app: GwcApp, { organisationId }: { organisationId: string; signal?: AbortSignal }): Promise<Store> {
  const store = await loadStoreView(app.pg, organisationId)
  if (!store) throw forbidden(PROBLEMS.STORE_NOT_FOUND, 'This organisation has no store yet.')
  return store
}

type Actor = { id: string; kind: 'merchant'; requestId: string }

export async function createStore(
  app: GwcApp,
  { organisationId, actor, body }: { organisationId: string; actor: Actor; body: CreateStoreRequest },
): Promise<Store> {
  return withTransaction(app.pg, async (client) => {
    let storeId: string
    try {
      const { rows } = await client.query(
        `INSERT INTO stores (organisation_id, description, opening_hours)
         VALUES ($1, $2, $3) RETURNING id`,
        [organisationId, body.description ?? null, body.openingHours ?? null],
      )
      storeId = String(rows[0].id)
    } catch (error) {
      // 23505 on the organisation's unique key is the rule "one store each".
      if ((error as { code?: string }).code === '23505') {
        throw forbidden(PROBLEMS.STORE_EXISTS, 'This organisation already has a store.')
      }
      throw error
    }
    await auditInTransaction(client, {
      action: 'store_created', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: actor.kind, targetType: 'store', targetId: storeId,
      detail: { storeChange: { after: { active: true } } },
    })
    return (await loadStoreView(client, organisationId))!
  })
}

export async function updateStore(
  app: GwcApp,
  { organisationId, actor, body }: { organisationId: string; actor: Actor; body: UpdateStoreRequest },
): Promise<Store> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `SELECT s.id, ${versionSql('s')} AS version FROM stores s WHERE s.organisation_id = $1 FOR UPDATE`,
      [organisationId],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.STORE_NOT_FOUND, 'This organisation has no store yet.')
    // Two users of one organisation share the store: an edit made on top of
    // someone else's is refused, not silently merged over it.
    if (rows[0].version !== body.version) {
      throw forbidden(PROBLEMS.CONFLICT, 'The store was changed by someone else. Reload and try again.')
    }

    const sets: string[] = []
    const changed: string[] = []
    const values: unknown[] = [organisationId]
    if (body.description !== undefined) { values.push(body.description); sets.push(`description = $${values.length}`); changed.push('description') }
    if (body.openingHours !== undefined) { values.push(body.openingHours); sets.push(`opening_hours = $${values.length}`); changed.push('openingHours') }
    if (sets.length > 0) {
      await client.query(`UPDATE stores SET ${sets.join(', ')} WHERE organisation_id = $1`, values)
      await auditInTransaction(client, {
        action: 'store_updated', outcome: 'allowed', requestId: actor.requestId,
        actorId: actor.id, actorKind: actor.kind, targetType: 'store', targetId: String(rows[0].id),
        detail: { storeChange: { changed } },
      })
    }
    return (await loadStoreView(client, organisationId))!
  })
}

/** The id of the organisation's store, or the standard "no store yet" refusal. */
export async function requireStoreId(db: Queryable, organisationId: string): Promise<{ id: string; active: boolean }> {
  const { rows } = await db.query('SELECT id, active FROM stores WHERE organisation_id = $1', [organisationId])
  if (rows.length === 0) throw forbidden(PROBLEMS.STORE_NOT_FOUND, 'This organisation has no store yet.')
  return { id: String(rows[0].id), active: Boolean(rows[0].active) }
}
