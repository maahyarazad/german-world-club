import { createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
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
  { status = 'active' }: { status?: string } = {},
) {
  // No permission flags: posting needs none since feature 021.
  const row = await createMember(app.pg, { status })
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
  /**
   * Feature 037: the state a `hidden` listing returns to. Leave it out for a
   * legacy hidden row (NULL, which restore reads as `active`).
   */
  hiddenFromState?: 'draft' | 'active'
  /** A `draft` is never inserted with a publication time unless asked. */
  published?: boolean
}

/**
 * Insert a listing directly, in any state. Returns its id.
 *
 * A job OFFER is inserted the way one came to exist before feature 021: with
 * row triggers off for that one insert (`session_replication_role = replica`,
 * transaction-local, test database only). The `marketplace_no_new_job_offer`
 * trigger refuses creating one now, but the browse, filter and public-summary
 * suites need the job offers that predate it — they stay visible until they
 * end (021 FR-008, FR-012).
 */
export async function seedListing(pool: Pool, seed: ListingSeed): Promise<string> {
  const {
    ownerId, category = 'general', mode = 'offer',
    title = `A ${category} ${mode}`, state = 'active', expiresAt = null, details = {},
    hiddenFromState, published = state !== 'draft',
  } = seed

  const legacy = category === 'job' && mode === 'offer'
  const client = await pool.connect()
  let rows: Array<{ id: unknown }>
  try {
    await client.query('BEGIN')
    if (legacy) await client.query('SET LOCAL session_replication_role = replica')
    ;({ rows } = await client.query(
    `INSERT INTO marketplace_listings
       (owner_id, category, mode, title, body, state, terms_version,
        published_at, expires_at, state_changed_at, hidden_from_state)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $9::boolean THEN now() END, $8, now(), $10)
     RETURNING id`,
    [ownerId, category, mode, title,
     'A body comfortably longer than the ten-character minimum.', state, TERMS, expiresAt,
     published, hiddenFromState ?? null],
    ))
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
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

/**
 * Push an already-published listing's expiry into the past, directly by SQL.
 *
 * `seedListing({ expiresAt: <a past date> })` cannot do this itself: the
 * `listings_expiry_after_publication` CHECK requires `expires_at >
 * published_at`, and `seedListing` publishes at `now()` in the same INSERT —
 * so an expiry earlier than "now" is also earlier than `published_at` and the
 * constraint refuses the row outright. Setting it to `published_at + 1ms`
 * satisfies the constraint (still strictly after publication) while already
 * being in the past by the time a test's job run checks it against a LATER
 * `now()`.
 */
export async function expireInThePast(pool: Pool, listingId: string) {
  await pool.query(
    `UPDATE marketplace_listings SET expires_at = published_at + interval '1 millisecond'
      WHERE id = $1`,
    [listingId],
  )
}

/** Wipe every marketplace row between tests. */
export async function resetMarketplace(pool: Pool) {
  await pool.query('TRUNCATE marketplace_listings, marketplace_terms_acceptances CASCADE')
  await pool.query(`DELETE FROM counters WHERE scope = 'marketplace.listings'`)
}

/**
 * A staff member holding the given `marketplace_moderation` flags (feature 037).
 * `true` grants all five. Mirrors how `moderation.test.ts` builds one, so the
 * new suites do not each copy it.
 */
export async function staffWithModeration(
  app: GwcApp,
  flags: Partial<Record<'read' | 'write' | 'edit' | 'delete' | 'status', boolean>> | true,
) {
  const admin = await createAdmin(app.pg, { grants: { marketplace_moderation: flags } })
  const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  return { id: String(admin.id), headers }
}

/** The listing as the owner reads it, with its `version` — what a PATCH must send back. */
export async function ownVersion(app: GwcApp, headers: Record<string, string>, id: string): Promise<string> {
  const response = await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers })
  return String(response.json().version)
}

/**
 * PATCH a listing the way a real client does: read its `version` first, send it
 * back with the changes (feature 037 made it required). For a caller who cannot
 * read the listing — a stranger, or an id that does not exist — the version is a
 * placeholder, so the request still reaches the ownership check and a test can
 * assert that a stranger and a missing id answer identically.
 */
export async function patchListing(
  app: GwcApp, headers: Record<string, string>, id: string, body: Record<string, unknown>,
) {
  const probe = await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers })
  const version = probe.statusCode === 200 ? String(probe.json().version) : 'not-readable'
  return app.inject({
    method: 'PATCH', url: `/marketplace/listings/${id}`, headers,
    payload: { version, ...body } as never,
  })
}
