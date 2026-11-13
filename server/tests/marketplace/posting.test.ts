import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Posting a listing (§7, feature 008 US1).
 *
 * §7 requires an explicit per-member permission flag and acceptance of terms
 * before a member may post. Both are checked here against the API, never
 * against a form: the absent compose control in the console is a courtesy, and
 * the server is the control (FR-001, FR-002).
 */

const TERMS = 'v1'

describe.skipIf(!hasDatabase)('posting a marketplace listing', () => {
  let app: GwcApp

  beforeAll(async () => {
    app = await buildAuthApp()
  })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await app.pg.query('TRUNCATE marketplace_listings, marketplace_terms_acceptances CASCADE')
    await resetAuthTables(app.pg)
  })

  /**
   * A member, their bearer header, and their accepted terms if asked for.
   *
   * No permission flags: since feature 021 posting needs none. `permissions`
   * is only passed to prove a stale `marketplace_post: false` changes nothing.
   */
  const member = async ({ acceptTerms = true, permissions = {} as Record<string, boolean> } = {}) => {
    const row = await createMember(app.pg, { permissions })
    if (acceptTerms) {
      await app.pg.query(
        'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
        [row.id, TERMS],
      )
    }
    const headers = await bearerFor(app, { accountId: row.id, accountKind: 'member' })
    return { row, headers }
  }

  const post = (headers: Record<string, string>, body: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers, payload: body })

  const generalListing = (over: Record<string, unknown> = {}) => ({
    category: 'general',
    mode: 'offer',
    title: 'Bicycle repair service',
    body: 'I service road and city bikes in Dubai Marina. Collection possible.',
    details: { kind: 'service', price_minor: 15000, currency: 'AED' },
    termsVersion: TERMS,
    ...over,
  })

  // ---- Anyone may post (021 FR-001, FR-003) --------------------------------

  it('accepts a listing from a member with NO permission flags', async () => {
    // Feature 021 opened posting to every onboarded member. Before it, this
    // member was refused 403 permission-required.
    const { headers } = await member()
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(201)
    expect(response.json().category).toBe('general')
  })

  it('accepts a member whose stored flag says marketplace_post: false', async () => {
    // The retired key is consulted nowhere — not even a leftover `false`.
    const { headers } = await member({ permissions: { marketplace_post: false } })
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(201)
  })

  it('still REFUSES an applicant whose profiling is incomplete — the counter-assertion', async () => {
    // "Every member may post" means every ONBOARDED member. Without this, a
    // server that dropped the onboarding gate would pass the two tests above.
    const { row, headers } = await member()
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
       VALUES ($1, 'device-x', 'approved', now(), now())`,
      [row.id],
    )
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(403)
    expect(response.json().type).toMatch(/profiling-incomplete/)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM marketplace_listings')
    expect(rows[0].n).toBe(0)
  })

  // ---- Terms (FR-002) ------------------------------------------------------

  it('refuses a member who has not accepted the terms', async () => {
    const { headers } = await member({ acceptTerms: false })
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json())).toMatch(/terms/i)
  })

  it('refuses a member who accepted an OLDER version', async () => {
    // A boolean "has accepted" answers the wrong question the first time the
    // terms change. This is why acceptance is versioned.
    const { row, headers } = await member({ acceptTerms: false })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [row.id, 'v0'],
    )
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json())).toMatch(/terms/i)
  })

  // ---- Category-specific required fields (FR-006, FR-009, SC-018) ----------

  it('refuses a vehicle listing missing a vehicle-required field, naming it', async () => {
    const { headers } = await member()
    const response = await post(headers, generalListing({
      category: 'vehicle',
      details: { price_minor: 900000, currency: 'AED' },   // no `make`
    }))

    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json())).toMatch(/make/)
  })

  it('ACCEPTS the same payload as a general listing — required sets differ', async () => {
    // The pair that makes per-category validation meaningful. Without this the
    // first half would pass against a server that refused everything.
    const { headers } = await member()
    const response = await post(headers, generalListing({
      details: { kind: 'product', price_minor: 900000, currency: 'AED' },
    }))

    expect(response.statusCode).toBe(201)
  })

  it('accepts a listing in each of the four categories', async () => {
    const { headers } = await member()
    const payloads = [
      generalListing(),
      generalListing({ category: 'vehicle', details: { make: 'Toyota', price_minor: 900000 } }),
      generalListing({ category: 'property', details: { deal: 'rent', city: 'Dubai', rooms: 2.5 } }),
      // A job REQUEST: members look for work, they do not offer it (021).
      generalListing({ category: 'job', mode: 'request', details: { employment_type: 'full_time', city: 'Dubai' } }),
    ]
    for (const payload of payloads) {
      const response = await post(headers, payload)
      expect(response.statusCode, `${payload.category}: ${response.body}`).toBe(201)
    }
  })

  // ---- Expiry is optional and may be unlimited (FR-028) --------------------

  it('treats an omitted expiry as unlimited rather than as missing', async () => {
    const { headers } = await member()
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(201)
    expect(response.json().expiresAt ?? null).toBeNull()
  })
})
