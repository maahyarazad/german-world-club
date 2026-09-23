import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'
import type { MarketplaceCategory } from '@gwc/contracts/marketplace'

/**
 * The marketplace index (US2, FR-010, FR-011).
 *
 * **Every query names its columns.** Constitution 2.0.0 removed the
 * response-schema requirement and named no replacement, so this is the only
 * thing standing between a column added to `members` later and a marketplace
 * response. `tests/marketplace/no-select-star` enforces it.
 *
 * **The owner's standing is joined live**, not read from a denormalised flag.
 * §3.2 already decides that a locked, inactive or ended member cannot sign in;
 * their listings should not keep selling. A cached copy of that is what
 * Principle III forbids, and it would need a fan-out to replay on
 * reinstatement (research.md R7). The cost is a join on the hot path, which is
 * what the partial index in 019_marketplace.sql accounts for.
 */

/** Columns the index reads. Named, never `*`. */
const LISTING_COLUMNS = `
  l.id, l.category, l.mode, l.title, l.body, l.state, l.contact_method,
  l.created_at, l.published_at, l.expires_at,
  m.id AS owner_id, m.display_name AS owner_display_name
`

const DETAIL_TABLE: Readonly<Record<MarketplaceCategory, string>> = Object.freeze({
  vehicle: 'marketplace_vehicle_details',
  property: 'marketplace_property_details',
  job: 'marketplace_job_details',
  general: 'marketplace_general_details',
})

export type BrowseFilters = {
  category?: MarketplaceCategory
  mode?: string
  /** Already coerced and bounded by the controller — see FR-010 and R8. */
  limit: number
  cursor?: { createdAt: string; id: string } | null
  /** Category-specific filters, validated against the field definitions. */
  detail?: Record<string, string>
  signal?: AbortSignal
}

/** Raised when a filter names a field the category does not have. */
export class UnknownFilterError extends Error {
  readonly field: string
  constructor(field: string, category?: string) {
    super(`"${field}" is not a filter${category ? ` on ${category} listings` : ''}.`)
    this.name = 'UnknownFilterError'
    this.field = field
  }
}

/**
 * Turn the category-specific query parameters into predicates.
 *
 * Only fields the definition marks `filterable` are accepted, and each has a
 * backing index asserted by `tests/marketplace/definitions.test.ts`. A filter
 * with no index is a sequential scan that looks fine until the corpus grows.
 *
 * Column names come from the definition, never from the request — the request
 * only ever supplies values, which are parameterised.
 */
function detailPredicates(
  category: MarketplaceCategory,
  filters: Record<string, string>,
  params: unknown[],
): string[] {
  const filterable = new Map(
    CATEGORY_DEFS[category].fields.filter((f) => f.filterable).map((f) => [f.key, f]),
  )
  const clauses: string[] = []

  for (const [key, value] of Object.entries(filters)) {
    // Range suffixes, so a numeric field gets `_min`/`_max` without the
    // definition having to enumerate both. The prefix is the field key
    // exactly — `price_minor_min`, not `price_min`. Clunkier, and
    // unambiguous: a shortened alias could not tell `price` from
    // `price_minor` if a category ever had both.
    const range = key.endsWith('_min') ? 'min' : key.endsWith('_max') ? 'max' : null
    const field = range ? key.slice(0, -4) : key

    const def = filterable.get(field)
    if (!def) throw new UnknownFilterError(key, category)

    params.push(value)
    const placeholder = `$${params.length}`

    if (range === 'min') clauses.push(`d.${field} >= ${placeholder}::numeric`)
    else if (range === 'max') clauses.push(`d.${field} <= ${placeholder}::numeric`)
    else if (def.kind === 'text') clauses.push(`d.${field} = ${placeholder}::citext`)
    else clauses.push(`d.${field}::text = ${placeholder}`)
  }

  return clauses
}

export async function browseListings(app: GwcApp, filters: BrowseFilters) {
  const { category, mode, limit, cursor, detail = {}, signal } = filters

  if (!category && Object.keys(detail).length > 0) {
    // A category-specific filter with no category names no table to apply it
    // to. Guessing would silently ignore it.
    throw new UnknownFilterError(Object.keys(detail)[0]!)
  }

  const params: unknown[] = []
  const where: string[] = [`l.state = 'active'`, `m.status = 'active'`]

  if (category) { params.push(category); where.push(`l.category = $${params.length}::marketplace_category`) }
  if (mode) { params.push(mode); where.push(`l.mode = $${params.length}::marketplace_mode`) }

  // Keyset, not offset. A classifieds index is append-heavy and offset paging
  // skips or repeats rows as listings arrive mid-scroll (research.md R8).
  if (cursor) {
    params.push(cursor.createdAt, cursor.id)
    where.push(`(l.created_at, l.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
  }

  // Exactly one detail table when a category is named, none when it is not.
  const join = category ? `JOIN ${DETAIL_TABLE[category]} d ON d.listing_id = l.id` : ''
  if (category) where.push(...detailPredicates(category, detail, params))

  const detailColumns = category
    ? `, to_jsonb(d.*) - 'listing_id' AS details`
    : `, '{}'::jsonb AS details`

  params.push(limit + 1) // one extra, to know whether another page exists
  const { rows } = await query(
    app.pg,
    `SELECT ${LISTING_COLUMNS}${detailColumns}
       FROM marketplace_listings l
       JOIN members m ON m.id = l.owner_id
       ${join}
      WHERE ${where.join(' AND ')}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT $${params.length}`,
    params,
    { signal },
  )

  const hasMore = rows.length > limit
  return { rows: hasMore ? rows.slice(0, limit) : rows, hasMore }
}

/**
 * One listing by id, only while it is visible (FR-012).
 *
 * The return type is declared rather than inferred. Inferred, TypeScript unions
 * the three shapes and `row` narrows to what they have in common, which drops
 * `row.id` — the one column the media join needs at the call site.
 */
type VisibleListing = { row: Record<string, unknown> | null; state: string | null }

export async function findVisibleListing(
  app: GwcApp,
  id: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<VisibleListing> {
  const { rows } = await query(
    app.pg,
    `SELECT ${LISTING_COLUMNS}, l.owner_id AS raw_owner_id
       FROM marketplace_listings l
       JOIN members m ON m.id = l.owner_id
      WHERE l.id = $1::uuid`,
    [id],
    { signal },
  )
  const row = rows[0]
  if (!row) return { row: null, state: null }

  const visible = row.state === 'active' && row.status !== 'inactive'
  if (!visible) return { row: null, state: String(row.state) }

  const table = DETAIL_TABLE[row.category as MarketplaceCategory]
  const { rows: details } = await query(
    app.pg,
    `SELECT to_jsonb(d.*) - 'listing_id' AS details FROM ${table} d WHERE d.listing_id = $1::uuid`,
    [id],
    { signal },
  )
  return {
    row: { ...row, details: details[0]?.details ?? {} }, state: String(row.state),
  }
}
