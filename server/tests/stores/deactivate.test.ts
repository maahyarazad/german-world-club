import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, staffWith, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, US4: staff switch a store off with a PUT, and back on. The flag
 * may be set to `false` or `0`. It takes effect on the next request, hides the
 * store and its offers from every user, refuses redemption, keeps the data,
 * and is audited.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const put = (headers: Record<string, string>, storeId: string, payload: object) =>
  app.inject({ method: 'PUT', url: `/admin/stores/${storeId}/active`, headers, payload })
const redeem = (headers: Record<string, string>, offerId: string) =>
  app.inject({ method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers, payload: { requestId: randomUUID() } })
const visibleTo = async (headers: Record<string, string>, offerId: string) =>
  (await app.inject({ method: 'GET', url: `${CLUB_OFFERS.member}/${offerId}`, headers })).statusCode === 200

async function setup() {
  const merchant = await merchantWithStore(app)
  const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, perPersonLimit: null })
  const member = await redeemerFor(app, 'member')
  const staff = await staffWith(app, { merchant_offers: { read: true, status: true } })
  return { merchant, offerId, member, staff }
}

describe.skipIf(!hasDatabase)('switching a store off', () => {
  it.each([[false], [0]])('deactivates with active = %s and hides the store’s offers at once', async (flag) => {
    const { merchant, offerId, member, staff } = await setup()
    expect(await visibleTo(member.headers, offerId)).toBe(true)

    const response = await put(staff.headers, merchant.storeId, { active: flag, reason: 'Beschwerden' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: merchant.storeId, active: false, deactivationReason: 'Beschwerden' })

    expect(await visibleTo(member.headers, offerId)).toBe(false)
    const list = await app.inject({ method: 'GET', url: CLUB_OFFERS.member, headers: member.headers })
    expect(list.json().items).toEqual([])
  })

  it('refuses redemption of its offers and records nothing', async () => {
    const { merchant, offerId, member, staff } = await setup()
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Test' })
    expect((await redeem(member.headers, offerId)).statusCode).toBe(404)
    expect(Number((await app.pg.query('SELECT count(*)::int AS n FROM redemptions')).rows[0].n)).toBe(0)
  })

  it('keeps the merchant’s data and history, shows them a notice, and stops them publishing', async () => {
    const { merchant, offerId, member, staff } = await setup()
    await redeem(member.headers, offerId)
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Geheimer-Grund-42' })

    const store = (await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json()
    expect(store).toMatchObject({ active: false, deactivationNotice: 'deactivated' })
    // The staff reason is for staff: the merchant gets a code, not the text.
    expect(JSON.stringify(store)).not.toContain('Geheimer-Grund-42')

    const report = (await app.inject({ method: 'GET', url: '/merchant/reports/redemptions', headers: merchant.headers })).json()
    expect(report.totals.count).toBe(1)

    const draft = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft' })
    const publish = await app.inject({ method: 'POST', url: `/merchant/offers/${draft}/publish`, headers: merchant.headers })
    expect(publish.statusCode).toBe(409)
    expect(publish.json().type).toContain('store-inactive')
  })

  it('is undone by switching it back on, and everything returns', async () => {
    const { merchant, offerId, member, staff } = await setup()
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Test' })
    const on = await put(staff.headers, merchant.storeId, { active: true })
    expect(on.json()).toMatchObject({ active: true, deactivatedAt: null, deactivationReason: null })
    expect(await visibleTo(member.headers, offerId)).toBe(true)
    expect((await redeem(member.headers, offerId)).statusCode).toBe(201)
    expect((await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json().deactivationNotice).toBeNull()
  })

  it.each([true, 1])('reactivates with active = %s', async (flag) => {
    const { merchant, staff } = await setup()
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Test' })
    expect((await put(staff.headers, merchant.storeId, { active: flag })).json().active).toBe(true)
  })

  it('needs a reason to deactivate, and not to reactivate', async () => {
    const { merchant, staff } = await setup()
    expect((await put(staff.headers, merchant.storeId, { active: false })).statusCode).toBe(400)
    expect((await put(staff.headers, merchant.storeId, { active: 0 })).statusCode).toBe(400)
    expect((await app.pg.query('SELECT active FROM stores WHERE id = $1', [merchant.storeId])).rows[0].active).toBe(true)
    expect((await put(staff.headers, merchant.storeId, { active: true })).statusCode).toBe(200)
  })

  it('is idempotent: the same request twice changes and audits nothing the second time', async () => {
    const { merchant, staff } = await setup()
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Erste' })
    const second = await put(staff.headers, merchant.storeId, { active: false, reason: 'Zweite' })
    expect(second.statusCode).toBe(200)
    expect(second.json().deactivationReason).toBe('Erste')
    const { rows } = await app.pg.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'store_deactivated'`)
    expect(rows[0].n).toBe(1)
  })

  it('writes an audit entry naming the actor and the change', async () => {
    const { merchant, staff } = await setup()
    await put(staff.headers, merchant.storeId, { active: false, reason: 'Test' })
    const { rows } = await app.pg.query(
      `SELECT actor_id, actor_kind, target_id, detail FROM audit_log WHERE action = 'store_deactivated'`)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ actor_id: staff.id, actor_kind: 'admin', target_id: merchant.storeId })
    expect(rows[0].detail.storeChange).toEqual({ before: { active: true }, after: { active: false } })
  })

  it('answers an unknown store with 404', async () => {
    const { staff } = await setup()
    expect((await put(staff.headers, randomUUID(), { active: false, reason: 'Test' })).statusCode).toBe(404)
  })

  it('is refused without the status flag, and for a merchant or a member', async () => {
    const { merchant, member } = await setup()
    const readOnly = await staffWith(app, { merchant_offers: { read: true } })
    expect((await put(readOnly.headers, merchant.storeId, { active: false, reason: 'Test' })).statusCode).toBe(403)
    expect((await put(merchant.headers, merchant.storeId, { active: false, reason: 'Test' })).statusCode).toBeGreaterThanOrEqual(401)
    expect((await put(member.headers, merchant.storeId, { active: false, reason: 'Test' })).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.pg.query('SELECT active FROM stores WHERE id = $1', [merchant.storeId])).rows[0].active).toBe(true)
  })

  it('lists every store with its organisation, state and offer count', async () => {
    const { merchant, staff } = await setup()
    const other = await merchantWithStore(app, { displayName: 'Zweites Café' })
    await put(staff.headers, other.storeId, { active: false, reason: 'Test' })
    const response = await app.inject({ method: 'GET', url: '/admin/stores', headers: staff.headers })
    expect(response.statusCode).toBe(200)
    const byId = Object.fromEntries(response.json().items.map((s: { id: string }) => [s.id, s]))
    expect(byId[merchant.storeId]).toMatchObject({ active: true, displayName: 'Café Test', offerCount: 1 })
    expect(byId[other.storeId]).toMatchObject({ active: false, displayName: 'Zweites Café', deactivationReason: 'Test' })
    expect(response.body).not.toMatch(/legal_?name|fee_?tier/i)
  })

  it('treats a suspended organisation like a switched-off store — the offer is not visible', async () => {
    const { merchant, offerId, member } = await setup()
    await app.pg.query(`UPDATE organisations SET status = 'suspended' WHERE id = $1`, [merchant.organisationId])
    expect(await visibleTo(member.headers, offerId)).toBe(false)
  })
})
