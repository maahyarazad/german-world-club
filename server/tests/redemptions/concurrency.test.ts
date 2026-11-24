import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, SC-003 and FR-017: redeeming is exact under concurrency. The last
 * unit goes to exactly one of a crowd, and the same request sent twice at once
 * is one redemption.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

describe.skipIf(!hasDatabase)('redeeming at the same moment', () => {
  it('gives the last unit to exactly one of 100 simultaneous accounts', async () => {
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, remaining: 1 })
    const crowd = await Promise.all(Array.from({ length: 100 }, () => redeemerFor(app, 'member')))

    const responses = await Promise.all(crowd.map((m) => app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: m.headers, payload: { requestId: randomUUID() },
    })))

    const codes = responses.map((r) => r.statusCode)
    expect(codes.filter((c) => c === 201)).toHaveLength(1)
    expect(codes.filter((c) => c === 409)).toHaveLength(99)
    expect(responses.filter((r) => r.statusCode === 409).every((r) => r.json().type.includes('sold-out'))).toBe(true)

    const { rows } = await app.pg.query('SELECT remaining FROM offers WHERE id = $1', [offerId])
    expect(rows[0].remaining).toBe(0)
    expect(Number((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n)).toBe(1)
  })

  it('sells exactly the stock it has, never more', async () => {
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, remaining: 5 })
    const crowd = await Promise.all(Array.from({ length: 20 }, () => redeemerFor(app, 'member')))

    const responses = await Promise.all(crowd.map((m) => app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: m.headers, payload: { requestId: randomUUID() },
    })))
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(5)
    expect((await app.pg.query('SELECT remaining FROM offers WHERE id = $1', [offerId])).rows[0].remaining).toBe(0)
  })

  it('makes one redemption of the same request sent twice at once', async () => {
    const merchant = await merchantWithStore(app)
    // A per-person limit of one: if the second request were judged on its own it
    // would be refused, not answered with the first one's redemption.
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, remaining: 10, perPersonLimit: 1 })
    const member = await redeemerFor(app, 'member')
    const requestId = randomUUID()

    const [a, b] = (await Promise.all([1, 2].map(() => app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId },
    })))) as [Awaited<ReturnType<typeof app.inject>>, Awaited<ReturnType<typeof app.inject>>]

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201])
    expect(a.json().id).toBe(b.json().id)
    expect(Number((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n)).toBe(1)
    expect((await app.pg.query('SELECT remaining FROM offers WHERE id = $1', [offerId])).rows[0].remaining).toBe(9)
  })

  it('lets one person redeem a limited offer only once even when they send two different requests together', async () => {
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, remaining: 10, perPersonLimit: 1 })
    const member = await redeemerFor(app, 'member')
    const responses = await Promise.all([1, 2].map(() => app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId: randomUUID() },
    })))
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409])
    expect((await app.pg.query('SELECT remaining FROM offers WHERE id = $1', [offerId])).rows[0].remaining).toBe(9)
  })
})
