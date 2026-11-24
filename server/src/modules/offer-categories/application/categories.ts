import type { OfferCategory } from '@gwc/contracts/offers'
import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Offer categories (feature 035, research R4).
 *
 * Staff-owned content: both names are data, so nothing here is server-emitted
 * interface text. A hidden category stays on the offers that already have it;
 * hiding only stops merchants choosing it for new ones, which is why the
 * merchant's list filters on `visible` and an offer's own category does not.
 */

const CATEGORY_COLUMNS = `c.id, c.slug, c.name_de, c.name_en, c.position, c.visible`

export const toCategory = (row: Record<string, unknown>): OfferCategory => ({
  id: String(row.id),
  slug: String(row.slug),
  nameDe: String(row.name_de),
  nameEn: String(row.name_en),
  position: Number(row.position),
  visible: Boolean(row.visible),
  offerCount: Number(row.offer_count ?? 0),
})

/** What a merchant may choose from when creating or moving an offer. */
export async function listChoosableCategories(app: GwcApp, { signal }: { signal?: AbortSignal } = {}) {
  const { rows } = await query(
    app.pg,
    `SELECT ${CATEGORY_COLUMNS}, 0 AS offer_count
       FROM offer_categories c
      WHERE c.visible
      ORDER BY c.position, c.slug`,
    [],
    { signal },
  )
  return { items: rows.map(toCategory) }
}
