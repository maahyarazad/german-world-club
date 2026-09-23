import { createMember, bearerFor } from '../helpers/auth.ts'
import type { Pool } from 'pg'
import type { GwcApp } from '../../src/app.ts'

/**
 * Corpus helpers for the marketplace suites.
 *
 * Listings are inserted with SQL rather than through the API so a suite can
 * put a listing into a state the API will not produce — `hidden`, `expired`,
 * an owner who is `locked`. Those are exactly the states the visibility rules
 * exist for, and a corpus that could only contain reachable states would prove
 * nothing about them.
 */

export const TERMS = 'v1'

export async function poster(
  app: GwcApp,
  { status = 'active', canPost = true }: { status?: string; canPost?: boolean } = {},
) {
  const row = await createMember(app.pg, {
    status,
    permissions: canPost ? { marketplace_post: true } : {},
  })
  await app.pg.query(
    'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [row.id, TERMS],
  )
  const headers = await bearerFor(app, { accountId: row.id, accountKind: 'member' })
  return { id: String(row.id), headers }
}

type ListingSeed = {
  ownerId: string
  category?: string
  mode?: string
  title?: string
  state?: string
  expiresAt?: string | null
  details?: Record<string, unknown>
}

/** Insert a listing directly, in any state. Returns its id. */
export async function seedListing(pool: Pool, seed: ListingSeed): Promise<string> {
  const {
    ownerId, category = 'general', mode = 'offer',
    title = `A ${category} ${mode}`, state = 'active', expiresAt = null, details = {},
  } = seed

  const { rows } = await pool.query(
    `INSERT INTO marketplace_listings
       (owner_id, category, mode, title, body, state, terms_version,
        published_at, expires_at, state_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $8, now())
     RETURNING id`,
    [ownerId, category, mode, title,
     'A body comfortably longer than the ten-character minimum.', state, TERMS, expiresAt],
  )
  const id = String(rows[0].id)

  const table = {
    vehicle: 'marketplace_vehicle_details',
    property: 'marketplace_property_details',
    job: 'marketplace_job_details',
    general: 'marketplace_general_details',
  }[category]!

  const defaults: Record<string, Record<string, unknown>> = {
    vehicle: { make: 'Toyota' },
    property: { deal: 'rent', city: 'Dubai' },
    job: { employment_type: 'full_time', city: 'Dubai' },
    general: { kind: 'product' },
  }
  const merged = { ...defaults[category], ...details }
  const columns = Object.keys(merged)
  const values = Object.values(merged)

  await pool.query(
    `INSERT INTO ${table} (listing_id${columns.length ? ', ' + columns.join(', ') : ''})
     VALUES ($1${values.map((_, i) => `, $${i + 2}`).join('')})`,
    [id, ...values],
  )
  return id
}

/** Wipe every marketplace row between tests. */
export async function resetMarketplace(pool: Pool) {
  await pool.query('TRUNCATE marketplace_listings, marketplace_terms_acceptances CASCADE')
  await pool.query(`DELETE FROM counters WHERE scope = 'marketplace.listings'`)
}
