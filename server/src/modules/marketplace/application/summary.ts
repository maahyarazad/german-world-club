import { query } from '../../../db/query.ts'
import { MARKETPLACE_CATEGORIES } from '@gwc/contracts/marketplace'
import type { GwcApp } from '../../../app.ts'
import type { MarketplaceCategory } from '@gwc/contracts/marketplace'

/**
 * Aggregate counts for the public discovery page (US7, FR-034, FR-035).
 *
 * Club facts, not member data: a count is not an id, a title, a photo, a
 * price or an owner. That is the whole boundary FR-035 draws, and this
 * function is deliberately incapable of crossing it — it never selects a
 * column that could identify a listing or its owner, only `category` to
 * group by and `count(*)`.
 *
 * `active` only: a withdrawn, sold, expired or hidden listing is not a fact
 * about what the marketplace currently offers.
 */
export async function getMarketplaceSummary(
  app: GwcApp,
  { signal }: { signal?: AbortSignal } = {},
): Promise<{ total: number; byCategory: Record<MarketplaceCategory, number> }> {
  const { rows } = await query(
    app.pg,
    `SELECT category, count(*)::int AS n
       FROM marketplace_listings
      WHERE state = 'active'
      GROUP BY category`,
    [],
    { signal },
  )

  // Every category present at zero, not just the ones with rows — a category
  // nobody has posted to yet is still a real answer, not a missing key a
  // template has to guess about.
  const byCategory = Object.fromEntries(
    MARKETPLACE_CATEGORIES.map((category) => [category, 0]),
  ) as Record<MarketplaceCategory, number>

  let total = 0
  for (const row of rows) {
    const n = Number(row.n)
    byCategory[row.category as MarketplaceCategory] = n
    total += n
  }

  return { total, byCategory }
}
