import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetPush, merchantOffer } from '../push/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * `GET /member/offers/:id` (feature 011, research R11; Principle III).
 *
 * An offer is shown only while it is published and valid, from an active
 * organisation with a public face. Every other case — including an id that
 * never existed — answers the same 404, so the response cannot tell a member
 * which offers a merchant is preparing.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetPush(app.pg)
  await resetAuthTables(app.pg)
})

const DAY = 86_400_000

async function memberHeaders() {
  const row = await createMember(app.pg, { passwordHash: null })
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { authorization }
}

const get = (id: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/member/offers/${id}`, headers })

/**
 * Everything about a 404 that varies per request by construction, removed —
 * the same list tests/marketplace/ownership.test.ts uses: the request id and
 * date, the CSP nonce, the etag that moves with it, and the rate-limit count
 * this test itself decrements.
 */
const comparable = (response: Awaited<ReturnType<typeof get>>) => ({
  status: response.statusCode,
  body: { ...response.json(), instance: null, requestId: null },
  headers: Object.fromEntries(
    Object.entries(response.headers).filter(([k]) => ![
      'x-request-id', 'date', 'content-length', 'content-security-policy', 'etag', 'ratelimit-remaining',
    ].includes(k)),
  ),
})

describe.skipIf(!hasDatabase)('GET /member/offers/:id', () => {
  it('returns a published, currently valid offer with the merchant\'s public face only', async () => {
    const headers = await memberHeaders()
    const offer = await merchantOffer(app.pg, { state: 'published', displayName: 'Café Sichtbar' })

    const response = await get(offer.id, headers)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      id: offer.id,
      benefit: { kind: 'percentage', value: 20 },
      regularPriceCents: 1000,
      memberPriceCents: 800,
      merchant: { displayName: 'Café Sichtbar', slug: offer.slug, logo: null },
    })
    // Contract data stays on `organisations` (research R11).
    expect(response.body).not.toContain('Push Test GmbH (legal)')
    expect(response.body).not.toContain('tier-secret')
    expect(response.body).not.toMatch(/legal_?name|fee_?tier|legalName|feeTier/)
  })

  it.each([
    ['draft', { state: 'draft' }],
    ['pending', { state: 'pending' }],
    ['withdrawn', { state: 'withdrawn' }],
    ['not yet valid', { state: 'published', validFrom: new Date(Date.now() + DAY), validUntil: new Date(Date.now() + 10 * DAY) }],
    ['expired', { state: 'published', validFrom: new Date(Date.now() - 10 * DAY), validUntil: new Date(Date.now() - DAY) }],
    ['from a suspended merchant', { state: 'published', orgStatus: 'suspended' }],
  ])('answers a %s offer exactly like an unknown id', async (_label, seed) => {
    const headers = await memberHeaders()
    const hidden = await merchantOffer(app.pg, seed)

    const response = await get(hidden.id, headers)
    const absent = await get(randomUUID(), headers)

    expect(response.statusCode).toBe(404)
    expect(comparable(response)).toEqual(comparable(absent))
  })

  it('refuses an anonymous caller, a staff member and an applicant', async () => {
    const offer = await merchantOffer(app.pg, { state: 'published' })
    expect((await get(offer.id)).statusCode).toBe(401)

    const admin = await createAdmin(app.pg)
    const staff = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
    expect([401, 403]).toContain((await get(offer.id, { authorization: staff.authorization })).statusCode)

    const applicant = await createMember(app.pg, { passwordHash: null })
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at) VALUES ($1, 'd', 'pending', now())`,
      [applicant.id],
    )
    const bearer = await bearerFor(app, { accountId: String(applicant.id), accountKind: 'member' })
    expect((await get(offer.id, { authorization: bearer.authorization })).statusCode).toBe(403)
  })
})
