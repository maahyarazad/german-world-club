import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildAuthApp } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 042, research R11: a search with no index is a sequential scan that
 * looks fine until the corpus grows, so the four trigram indexes are asserted to
 * exist rather than trusted. In the spirit of `tests/marketplace/definitions.test.ts`,
 * which does the same for the marketplace's filters.
 *
 * They are **partial on the live state**: a draft, a withdrawn offer or a hidden
 * listing is never in the index, so it cannot be reached through it, and the
 * index stays small. Each predicate is a literal conjunct of the query's own WHERE
 * (`VISIBLE_OFFER` has `o.state = 'published'`; marketplace browse has
 * `l.state = 'active'`), which is what lets the planner use it.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const EXPECTED = [
  { name: 'offers_title_trgm_idx', table: 'offers', column: 'title', live: 'published' },
  { name: 'offers_description_trgm_idx', table: 'offers', column: 'description', live: 'published' },
  { name: 'listings_title_trgm_idx', table: 'marketplace_listings', column: 'title', live: 'active' },
  { name: 'listings_body_trgm_idx', table: 'marketplace_listings', column: 'body', live: 'active' },
] as const

describe.skipIf(!hasDatabase)('the search indexes', () => {
  it('has the pg_trgm extension', async () => {
    const { rows } = await app.pg.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`)
    expect(rows).toHaveLength(1)
  })

  it.each(EXPECTED)('has $name: a GIN trigram index on $table.$column, partial on state = $live', async ({ name, table, column, live }) => {
    const { rows } = await app.pg.query(
      'SELECT tablename, indexdef FROM pg_indexes WHERE indexname = $1', [name],
    )
    expect(rows, `${name} is missing`).toHaveLength(1)
    const def = String(rows[0].indexdef)
    expect(rows[0].tablename).toBe(table)
    expect(def).toMatch(/USING gin/)
    expect(def).toMatch(new RegExp(`\\(${column} gin_trgm_ops\\)`))
    expect(def).toMatch(new RegExp(`WHERE \\(state = '${live}'`))
  })
})
