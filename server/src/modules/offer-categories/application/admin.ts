import { PROBLEMS } from '@gwc/contracts/errors'
import type { OfferCategory } from '@gwc/contracts/offers'
import { withTransaction, query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { auditInTransaction } from '../../../ops/audit.ts'
import { toCategory } from './categories.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Staff management of offer categories (feature 035, research R4).
 *
 * Add, rename, reorder, hide and show. There is no delete: hiding is enough, a
 * category with offers cannot go (the foreign key refuses), and nothing here
 * ever changes which category an existing offer is under. Hiding keeps the
 * category on its offers, which stay visible and redeemable; it only stops
 * merchants choosing it for new ones.
 */

const SELECT = `
  SELECT c.id, c.slug, c.name_de, c.name_en, c.position, c.visible,
         (SELECT count(*)::int FROM offers o WHERE o.category_id = c.id) AS offer_count
    FROM offer_categories c`

export async function listAllCategories(app: GwcApp, { signal }: { signal?: AbortSignal } = {}) {
  const { rows } = await query(app.pg, `${SELECT} ORDER BY c.position, c.slug`, [], { signal })
  return { items: rows.map(toCategory) }
}

type Actor = { id: string; requestId: string }

export async function createCategory(
  app: GwcApp,
  { slug, nameDe, nameEn, actor }: { slug: string; nameDe: string; nameEn: string; actor: Actor },
): Promise<OfferCategory> {
  return withTransaction(app.pg, async (client) => {
    let id: string
    try {
      const { rows } = await client.query(
        `INSERT INTO offer_categories (slug, name_de, name_en, position)
         VALUES ($1, $2, $3, COALESCE((SELECT max(position) FROM offer_categories), 0) + 10)
         RETURNING id`,
        [slug, nameDe, nameEn],
      )
      id = String(rows[0].id)
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw forbidden(PROBLEMS.CONFLICT, 'A category with this slug already exists.')
      }
      throw error
    }
    await auditInTransaction(client, {
      action: 'offer_category_created', outcome: 'allowed', requestId: actor.requestId,
      actorId: actor.id, actorKind: 'admin', targetType: 'offer_category', targetId: id,
      detail: { categoryChange: { after: { slug } } },
    })
    const { rows } = await client.query(`${SELECT} WHERE c.id = $1`, [id])
    return toCategory(rows[0])
  })
}

export async function updateCategory(
  app: GwcApp,
  { id, changes, actor }: {
    id: string; actor: Actor
    changes: { nameDe?: string; nameEn?: string; position?: number; visible?: boolean }
  },
): Promise<OfferCategory> {
  return withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      'SELECT name_de, name_en, position, visible FROM offer_categories WHERE id = $1 FOR UPDATE', [id],
    )
    if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such category.')
    const before = rows[0]
    const next = {
      name_de: changes.nameDe ?? before.name_de,
      name_en: changes.nameEn ?? before.name_en,
      position: changes.position ?? before.position,
      visible: changes.visible ?? before.visible,
    }

    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((k) => next[k] !== before[k])
    if (changed.length > 0) {
      await client.query(
        'UPDATE offer_categories SET name_de = $2, name_en = $3, position = $4, visible = $5, updated_at = now() WHERE id = $1',
        [id, next.name_de, next.name_en, next.position, next.visible],
      )
      await auditInTransaction(client, {
        action: 'offer_category_updated', outcome: 'allowed', requestId: actor.requestId,
        actorId: actor.id, actorKind: 'admin', targetType: 'offer_category', targetId: id,
        detail: {
          categoryChange: {
            before: Object.fromEntries(changed.map((k) => [k, before[k]])),
            after: Object.fromEntries(changed.map((k) => [k, next[k]])),
          },
        },
      })
    }
    const { rows: fresh } = await client.query(`${SELECT} WHERE c.id = $1`, [id])
    return toCategory(fresh[0])
  })
}
