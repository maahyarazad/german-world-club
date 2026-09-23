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

  /** A member, their bearer header, and their accepted terms if asked for. */
  const member = async ({ canPost = true, acceptTerms = true } = {}) => {
    const row = await createMember(app.pg, {
      permissions: canPost ? { marketplace_post: true } : {},
    })
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

  // ---- The permission pair (FR-001, SC-001) --------------------------------

  it('accepts a listing from a member holding marketplace_post', async () => {
    const { headers } = await member()
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(201)
    expect(response.json().category).toBe('general')
  })

  it('REFUSES a member without the flag, at the API', async () => {
    // The whole point. A suite that only checked the happy path would pass
    // against a server that let anybody post, which is precisely the defect
    // an explicit per-member flag exists to prevent.
    const { headers } = await member({ canPost: false })
    const response = await post(headers, generalListing())

    expect(response.statusCode).toBe(403)
    expect(response.json().type).toMatch(/permission-required/)
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
      generalListing({ category: 'job', details: { employment_type: 'full_time', city: 'Dubai' } }),
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
