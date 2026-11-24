import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-016 - FR-019: redeeming an offer. A reference, the count going
 * down, a retry that changes nothing, the refusals that record nothing, and the
 * per-person limit.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const DAY = 86_400_000
const redeem = (headers: Record<string, string>, offerId: string, requestId = randomUUID(), prefix = CLUB_OFFERS.member) =>
  app.inject({ method: 'POST', url: `${prefix}/${offerId}/redemptions`, headers, payload: { requestId } })
const count = async () => Number((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n)
const remaining = async (id: string) => (await app.pg.query('SELECT remaining FROM offers WHERE id = $1', [id])).rows[0].remaining

async function setup(overrides: Parameters<typeof seedOffer>[1] extends infer T ? Partial<T> : never = {}) {
  const merchant = await merchantWithStore(app)
  const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, ...overrides })
  const member = await redeemerFor(app, 'member')
  return { merchant, offerId, member }
}

describe.skipIf(!hasDatabase)('redeeming an offer', () => {
  it('records a redemption with a reference, and counts the offer down by one', async () => {
    const { offerId, member } = await setup({ remaining: 5 })
    const response = await redeem(member.headers, offerId)

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ offerId })
    expect(response.json().reference).toMatch(/^GWC-[2-9A-HJ-NP-Z]{5}-[2-9A-HJ-NP-Z]{5}$/)
    expect(await remaining(offerId)).toBe(4)
    expect(await count()).toBe(1)
  })

  it('shows the redemption in the person’s own list', async () => {
    const { offerId, member } = await setup()
    const made = (await redeem(member.headers, offerId)).json()
    const list = await app.inject({ method: 'GET', url: `${CLUB_OFFERS.member}/redemptions`, headers: member.headers })
    expect(list.statusCode).toBe(200)
    expect(list.json().items.map((i: { id: string }) => i.id)).toEqual([made.id])
    expect(list.json().items[0].reference).toBe(made.reference)
  })

  it('records the redeemer from the session, never from the request', async () => {
    const { offerId, member } = await setup()
    const other = await redeemerFor(app, 'member')
    await app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers,
      payload: { requestId: randomUUID(), redeemerId: other.id, redeemerKind: 'admin' },
    })
    const { rows } = await app.pg.query('SELECT redeemer_kind, redeemer_id FROM redemptions')
    expect(rows).toEqual([{ redeemer_kind: 'member', redeemer_id: member.id }])
  })

  it('answers a repeated request id with the original and changes nothing', async () => {
    const { offerId, member } = await setup({ remaining: 5, perPersonLimit: null })
    const requestId = randomUUID()
    const first = await redeem(member.headers, offerId, requestId)
    const again = await redeem(member.headers, offerId, requestId)

    expect(first.statusCode).toBe(201)
    expect(again.statusCode).toBe(200)
    expect(again.json().id).toBe(first.json().id)
    expect(again.json().reference).toBe(first.json().reference)
    expect(await count()).toBe(1)
    expect(await remaining(offerId)).toBe(4)
  })

  it('still answers the original after the offer has been withdrawn', async () => {
    const { offerId, member } = await setup()
    const requestId = randomUUID()
    const first = await redeem(member.headers, offerId, requestId)
    await app.pg.query(`UPDATE offers SET state = 'withdrawn' WHERE id = $1`, [offerId])
    const again = await redeem(member.headers, offerId, requestId)
    expect(again.statusCode).toBe(200)
    expect(again.json().id).toBe(first.json().id)
  })

  it('refuses a request id reused for a different offer', async () => {
    const { merchant, offerId, member } = await setup({ perPersonLimit: null })
    const other = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, perPersonLimit: null })
    const requestId = randomUUID()
    await redeem(member.headers, offerId, requestId)
    expect((await redeem(member.headers, other, requestId)).statusCode).toBe(409)
    expect(await count()).toBe(1)
  })

  it.each([
    ['a withdrawn offer', { state: 'withdrawn' }],
    ['a draft', { state: 'draft' }],
    ['an expired offer', { validFrom: new Date(Date.now() - 10 * DAY), validUntil: new Date(Date.now() - DAY) }],
    ['an offer that has not started', { validFrom: new Date(Date.now() + DAY), validUntil: new Date(Date.now() + 10 * DAY) }],
  ])('refuses %s as if it did not exist, and records nothing', async (_label, seed) => {
    const { offerId, member } = await setup(seed)
    const absent = await redeem(member.headers, randomUUID())
    const response = await redeem(member.headers, offerId)
    expect(response.statusCode).toBe(404)
    expect(response.json().type).toBe(absent.json().type)
    expect(await count()).toBe(0)
  })

  it('refuses an offer from a switched-off store, and records nothing', async () => {
    const { merchant, offerId, member } = await setup()
    await app.pg.query(`UPDATE stores SET active = false, deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`, [merchant.storeId])
    expect((await redeem(member.headers, offerId)).statusCode).toBe(404)
    expect(await count()).toBe(0)
    // The counter-assertion: switch it back on and the same request works.
    await app.pg.query('UPDATE stores SET active = true, deactivated_at = NULL, deactivation_reason = NULL WHERE id = $1', [merchant.storeId])
    expect((await redeem(member.headers, offerId)).statusCode).toBe(201)
  })

  it('refuses a sold-out offer with 409 sold-out and records nothing', async () => {
    const { offerId, member } = await setup({ remaining: 0 })
    const response = await redeem(member.headers, offerId)
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toContain('sold-out')
    expect(await count()).toBe(0)
    expect(await remaining(offerId)).toBe(0)
  })

  it('enforces the per-person limit for the same person but not for another', async () => {
    const { offerId, member } = await setup({ perPersonLimit: 1 })
    expect((await redeem(member.headers, offerId)).statusCode).toBe(201)

    const second = await redeem(member.headers, offerId)
    expect(second.statusCode).toBe(409)
    expect(second.json().type).toContain('per-person-limit-reached')

    const another = await redeemerFor(app, 'member')
    expect((await redeem(another.headers, offerId)).statusCode).toBe(201)
    expect(await count()).toBe(2)
  })

  it('treats no limit and unlimited stock as unlimited, not as zero — the counter-assertion', async () => {
    const { offerId, member } = await setup({ perPersonLimit: null, remaining: null })
    for (let i = 0; i < 3; i += 1) expect((await redeem(member.headers, offerId)).statusCode).toBe(201)
    expect(await count()).toBe(3)
    expect(await remaining(offerId)).toBeNull()
  })

  it('estimates a saving only where both prices exist', async () => {
    const priced = await setup({ regularPriceCents: 1000, memberPriceCents: 700 })
    await redeem(priced.member.headers, priced.offerId)
    const gift = await setup({ benefitKind: 'freebie', regularPriceCents: null, memberPriceCents: null })
    await redeem(gift.member.headers, gift.offerId)

    const { rows } = await app.pg.query('SELECT estimated_saving_cents AS s FROM redemptions ORDER BY redeemed_at')
    expect(rows.map((r) => r.s)).toEqual([300, null])
  })

  it('copies the category at redemption, so a later change does not rewrite history', async () => {
    const { offerId, member } = await setup({ categorySlug: 'restaurants' })
    await redeem(member.headers, offerId)
    await app.pg.query(`UPDATE offers SET category_id = (SELECT id FROM offer_categories WHERE slug = 'travel') WHERE id = $1`, [offerId])
    const { rows } = await app.pg.query(
      `SELECT c.slug FROM redemptions r JOIN offer_categories c ON c.id = r.category_id`)
    expect(rows[0].slug).toBe('restaurants')
  })

  it('does not move the offer’s edit version when only the count changes', async () => {
    const { merchant, offerId, member } = await setup({ remaining: 5 })
    const before = (await app.inject({ method: 'GET', url: '/merchant/offers', headers: merchant.headers })).json().items[0].version
    await redeem(member.headers, offerId)
    const after = (await app.inject({ method: 'GET', url: '/merchant/offers', headers: merchant.headers })).json().items[0]
    expect(after.version).toBe(before)
    expect(after.remaining).toBe(4)
  })
})
