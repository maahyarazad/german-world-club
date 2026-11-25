import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, staffWith, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-021 - FR-024 and SC-007: a merchant's report holds only their
 * own redemptions, the platform report holds everyone's, totals cover the whole
 * filtered set, and the admin's total is the sum of the merchants'.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const redeem = async (offerId: string, who?: Awaited<ReturnType<typeof redeemerFor>>) => {
  const member = who ?? await redeemerFor(app, 'member')
  const response = await app.inject({
    method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId: randomUUID() },
  })
  expect(response.statusCode).toBe(201)
  return response.json()
}

async function twoMerchants() {
  const a = await merchantWithStore(app, { displayName: 'Alpha' })
  const b = await merchantWithStore(app, { displayName: 'Beta' })
  const offerA = await seedOffer(app.pg, { organisationId: a.organisationId, storeId: a.storeId, perPersonLimit: null, categorySlug: 'restaurants', title: 'A-Offer' })
  const offerB = await seedOffer(app.pg, { organisationId: b.organisationId, storeId: b.storeId, perPersonLimit: null, categorySlug: 'health', title: 'B-Offer', regularPriceCents: null, memberPriceCents: null })
  return { a, b, offerA, offerB }
}

const report = (headers: Record<string, string>, url: string) => app.inject({ method: 'GET', url, headers })

describe.skipIf(!hasDatabase)('the merchant report', () => {
  it('holds only the merchant’s own redemptions', async () => {
    const { a, offerA, offerB } = await twoMerchants()
    const mine = await redeem(offerA)
    await redeem(offerA)
    await redeem(offerB)

    const response = await report(a.headers, '/merchant/reports/redemptions')
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.totals.count).toBe(2)
    expect(body.rows.map((r: { offerId: string }) => r.offerId)).toEqual([offerA, offerA])
    expect(body.rows.some((r: { id: string }) => r.id === mine.id)).toBe(true)
    expect(body.byOffer).toHaveLength(1)
  })

  it('ignores an organisation id in the query — a parameter cannot widen it', async () => {
    const { a, b, offerA, offerB } = await twoMerchants()
    await redeem(offerA)
    await redeem(offerB)

    const response = await report(a.headers, `/merchant/reports/redemptions?organisationId=${b.organisationId}`)
    expect(response.json().totals.count).toBe(1)
    expect(response.json().rows[0].offerId).toBe(offerA)
  })

  it('answers an empty report, not an error, for a merchant with no redemptions', async () => {
    const { a } = await twoMerchants()
    const response = await report(a.headers, '/merchant/reports/redemptions')
    expect(response.json()).toMatchObject({ totals: { count: 0, estimatedSavingCents: null }, rows: [], byOffer: [], byDay: [], nextCursor: null })
  })

  it('totals the saving only where prices exist, and says null when none do', async () => {
    const { a, b, offerA, offerB } = await twoMerchants()
    await redeem(offerA)
    await redeem(offerB)
    expect((await report(a.headers, '/merchant/reports/redemptions')).json().totals.estimatedSavingCents).toBe(200)
    // Beta's offer is unpriced: no saving is invented.
    expect((await report(b.headers, '/merchant/reports/redemptions')).json().totals.estimatedSavingCents).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('the platform report', () => {
  it('holds everyone’s, and filters by merchant, category and date range', async () => {
    const { a, b, offerA, offerB } = await twoMerchants()
    await redeem(offerA); await redeem(offerA); await redeem(offerB)
    const admin = await staffWith(app, { merchant_offers: { read: true } })

    expect((await report(admin.headers, '/admin/reports/redemptions')).json().totals.count).toBe(3)
    expect((await report(admin.headers, `/admin/reports/redemptions?organisationId=${a.organisationId}`)).json().totals.count).toBe(2)
    expect((await report(admin.headers, `/admin/reports/redemptions?organisationId=${b.organisationId}`)).json().totals.count).toBe(1)

    const { rows } = await app.pg.query(`SELECT id FROM offer_categories WHERE slug = 'health'`)
    expect((await report(admin.headers, `/admin/reports/redemptions?categoryId=${rows[0].id}`)).json().totals.count).toBe(1)

    const future = new Date(Date.now() + 86_400_000).toISOString()
    expect((await report(admin.headers, `/admin/reports/redemptions?from=${encodeURIComponent(future)}`)).json().totals.count).toBe(0)
    const past = new Date(Date.now() - 86_400_000).toISOString()
    expect((await report(admin.headers, `/admin/reports/redemptions?from=${encodeURIComponent(past)}`)).json().totals.count).toBe(3)
  })

  it('totals to the sum of the merchants’ totals for the same period — SC-007', async () => {
    const { a, b, offerA, offerB } = await twoMerchants()
    for (let i = 0; i < 4; i += 1) await redeem(offerA)
    for (let i = 0; i < 3; i += 1) await redeem(offerB)
    const admin = await staffWith(app, {}, { superadmin: true })

    const platform = (await report(admin.headers, '/admin/reports/redemptions')).json().totals.count
    const mine = (await report(a.headers, '/merchant/reports/redemptions')).json().totals.count
    const theirs = (await report(b.headers, '/merchant/reports/redemptions')).json().totals.count
    expect(platform).toBe(7)
    expect(platform).toBe(mine + theirs)
  })

  it('counts the whole filtered set in the totals, not just the page', async () => {
    const { a, offerA } = await twoMerchants()
    const crowd = await Promise.all(Array.from({ length: 60 }, () => redeemerFor(app, 'member')))
    for (const m of crowd) await redeem(offerA, m)

    const first = (await report(a.headers, '/merchant/reports/redemptions')).json()
    expect(first.totals.count).toBe(60)
    expect(first.rows).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()
    const second = (await report(a.headers, `/merchant/reports/redemptions?cursor=${encodeURIComponent(first.nextCursor)}`)).json()
    expect(second.rows).toHaveLength(10)
    expect(second.totals.count).toBe(60)
    expect(new Set([...first.rows, ...second.rows].map((r: { id: string }) => r.id)).size).toBe(60)
  })

  it('groups by day within the filtered range', async () => {
    const { a, offerA } = await twoMerchants()
    await redeem(offerA); await redeem(offerA)
    const body = (await report(a.headers, '/merchant/reports/redemptions')).json()
    expect(body.byDay).toHaveLength(1)
    expect(body.byDay[0].count).toBe(2)
  })

  it('keeps a past redemption in its original category after the offer moves', async () => {
    const { a, offerA } = await twoMerchants()
    await redeem(offerA)
    await app.pg.query(`UPDATE offers SET category_id = (SELECT id FROM offer_categories WHERE slug = 'travel') WHERE id = $1`, [offerA])
    const { rows } = await app.pg.query(`SELECT id FROM offer_categories WHERE slug = 'restaurants'`)
    const filtered = (await report(a.headers, `/merchant/reports/redemptions?categoryId=${rows[0].id}`)).json()
    expect(filtered.totals.count).toBe(1)
  })
})
