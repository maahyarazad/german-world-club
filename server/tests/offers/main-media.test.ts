import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import {
  merchantWithStore, seedOffer, seedReadyAsset, redeemerFor, staffWith, resetOffers, CLUB_OFFERS,
} from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 042, US3 (FR-012 to FR-018): choosing which of an offer's existing
 * images or videos is the main one, by the offer's merchant and by a super admin.
 *
 * One application function, two doors. Each refusal below is paired with a check
 * that nothing changed, because a refusal that also rewrote the order would pass
 * a status-code assertion alone.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

type Response = Awaited<ReturnType<GwcApp['inject']>>

/** What varies per request by construction, removed (as tests/offers/ownership.test.ts does). */
const comparable = (response: Response) => ({
  status: response.statusCode,
  body: { ...response.json(), instance: null, requestId: null },
  headers: Object.fromEntries(
    Object.entries(response.headers).filter(([k]) => ![
      'x-request-id', 'date', 'content-length', 'content-security-policy', 'etag', 'ratelimit-remaining',
    ].includes(k)),
  ),
})

async function fixture(count = 3) {
  const merchant = await merchantWithStore(app)
  const offer = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
  const assets: string[] = []
  for (let i = 0; i < count; i++) {
    const id = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })
    await app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, $3)', [offer, id, i])
    assets.push(id)
  }
  const order = async () => (await app.pg.query(
    'SELECT asset_id, position FROM offer_media WHERE offer_id = $1 ORDER BY position', [offer],
  )).rows.map((r: { asset_id: string; position: number }) => [String(r.asset_id), r.position] as const)
  const audits = async () => (await app.pg.query(
    `SELECT action, actor_kind, outcome, required_permission, detail FROM audit_log
      WHERE target_id = $1 ORDER BY occurred_at, id`, [offer],
  )).rows
  const viaMerchant = (headers: Record<string, string>, assetId: string, offerId = offer) =>
    app.inject({ method: 'PUT', url: `/merchant/offers/${offerId}/main-media`, headers, payload: { assetId } })
  const viaStaff = (headers: Record<string, string>, assetId: string, offerId = offer) =>
    app.inject({ method: 'PUT', url: `/admin/offers/${offerId}/main-media`, headers, payload: { assetId } })
  return { merchant, offer, assets, order, audits, viaMerchant, viaStaff }
}

describe.skipIf(!hasDatabase)('choosing an offer’s main media — the merchant', () => {
  it('moves the chosen file to the front and keeps the others in their order, positions dense', async () => {
    const f = await fixture()
    const [a, b, c] = f.assets as [string, string, string]
    const res = await f.viaMerchant(f.merchant.headers, c)
    expect(res.statusCode).toBe(200)
    expect(res.json().media.map((m: { assetId: string }) => m.assetId)).toEqual([c, a, b])
    expect(await f.order()).toEqual([[c, 0], [a, 1], [b, 2]])
  })

  it('is what members then see first: on the list card and in the detail', async () => {
    const f = await fixture()
    const c = f.assets[2]!
    await f.viaMerchant(f.merchant.headers, c)
    const member = await redeemerFor(app, 'member')
    const list = (await app.inject({ method: 'GET', url: CLUB_OFFERS.member, headers: member.headers })).json()
    const detail = (await app.inject({ method: 'GET', url: `${CLUB_OFFERS.member}/${f.offer}`, headers: member.headers })).json()
    expect(list.items[0].thumbnail.assetId).toBe(c)
    expect(detail.media[0].assetId).toBe(c)
    expect(detail.media).toHaveLength(3)
  })

  it('lets a video lead, and the card then shows its still picture', async () => {
    const f = await fixture(2)
    const video = await seedReadyAsset(app.pg, { uploaderId: f.merchant.id, uploaderKind: 'merchant', kind: 'video' })
    await app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, 2)', [f.offer, video])
    expect((await f.viaMerchant(f.merchant.headers, video)).statusCode).toBe(200)

    const member = await redeemerFor(app, 'member')
    const thumb = (await app.inject({ method: 'GET', url: CLUB_OFFERS.member, headers: member.headers })).json().items[0].thumbnail
    expect(thumb.assetId).toBe(video)
    expect(thumb.kind).toBe('video')
    expect(thumb.posterUrl).toMatch(/poster/)
  })

  it('is idempotent: choosing the file that already leads changes nothing and writes no audit entry', async () => {
    const f = await fixture()
    const before = await f.order()
    const res = await f.viaMerchant(f.merchant.headers, f.assets[0]!)
    expect(res.statusCode).toBe(200)
    expect(res.json().media[0].assetId).toBe(f.assets[0])
    expect(await f.order()).toEqual(before)
    expect(await f.audits()).toHaveLength(0)
  })

  it('records one audit entry per real change, naming the actor and the change', async () => {
    const f = await fixture()
    await f.viaMerchant(f.merchant.headers, f.assets[1]!)
    const rows = await f.audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'offer_updated', actor_kind: 'merchant', outcome: 'allowed' })
    expect(rows[0].detail.offerChange.changed).toEqual(['mainMedia'])
    expect(rows[0].detail.offerChange.assetId).toBe(f.assets[1])
  })

  it('does not make the merchant’s open edit form stale (updated_at is not moved)', async () => {
    const f = await fixture()
    const read = async () => (await app.pg.query('SELECT updated_at::text AS v FROM offers WHERE id = $1', [f.offer])).rows[0].v
    const before = await read()
    await f.viaMerchant(f.merchant.headers, f.assets[2]!)
    expect(await read()).toBe(before)
  })

  it('answers another merchant’s offer exactly like an unknown id, and changes nothing', async () => {
    const f = await fixture()
    const stranger = await merchantWithStore(app)
    const before = await f.order()
    const foreign = await f.viaMerchant(stranger.headers, f.assets[2]!)
    const absent = await f.viaMerchant(stranger.headers, f.assets[2]!, randomUUID())
    expect(foreign.statusCode).toBe(404)
    expect(comparable(foreign)).toEqual(comparable(absent))
    expect(await f.order()).toEqual(before)
    expect(await f.audits()).toHaveLength(0)
  })

  it('refuses a file that is not on the offer with 422 media-not-attached, and changes nothing', async () => {
    const f = await fixture()
    const elsewhere = await seedReadyAsset(app.pg, { uploaderId: f.merchant.id, uploaderKind: 'merchant' })
    const before = await f.order()
    const res = await f.viaMerchant(f.merchant.headers, elsewhere)
    expect(res.statusCode).toBe(422)
    expect(res.json().type).toMatch(/\/offers\/media-not-attached$/)
    expect(await f.order()).toEqual(before)
    expect(await f.audits()).toHaveLength(0)
  })

  it('refuses something that is not an id', async () => {
    const f = await fixture()
    const res = await app.inject({
      method: 'PUT', url: `/merchant/offers/${f.offer}/main-media`, headers: f.merchant.headers, payload: { assetId: 'nope' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('survives two simultaneous choices: both answer, nothing is lost or repeated', async () => {
    const f = await fixture()
    const [a, b, c] = f.assets as [string, string, string]
    const [one, two] = await Promise.all([f.viaMerchant(f.merchant.headers, b), f.viaMerchant(f.merchant.headers, c)])
    expect([one.statusCode, two.statusCode]).toEqual([200, 200])
    const order = await f.order()
    expect(order.map(([id]) => id).sort()).toEqual([a, b, c].sort())
    expect(order.map(([, p]) => p)).toEqual([0, 1, 2])
    expect([b, c]).toContain(order[0]![0])
  })

  it('does not interleave with a whole-set replace: the set stays whole and dense', async () => {
    const f = await fixture()
    const [a, b, c] = f.assets as [string, string, string]
    const [main, replace] = await Promise.all([
      f.viaMerchant(f.merchant.headers, c),
      app.inject({ method: 'PUT', url: `/merchant/offers/${f.offer}/media`, headers: f.merchant.headers, payload: { assetIds: [a, b, c] } }),
    ])
    expect([main.statusCode, replace.statusCode]).toEqual([200, 200])
    const order = await f.order()
    expect(order.map(([id]) => id).sort()).toEqual([a, b, c].sort())
    expect(order.map(([, p]) => p)).toEqual([0, 1, 2])
  })
})

describe.skipIf(!hasDatabase)('choosing an offer’s main media — the super admin', () => {
  it('can choose for an offer of any organisation, and the change is audited as an admin', async () => {
    const f = await fixture()
    const admin = await staffWith(app, { merchant_offers: { edit: true } }, { superadmin: true })
    const res = await f.viaStaff(admin.headers, f.assets[2]!)
    expect(res.statusCode).toBe(200)
    expect(res.json().media[0].assetId).toBe(f.assets[2])
    expect((await f.order())[0]![0]).toBe(f.assets[2])
    const rows = await f.audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'offer_updated', actor_kind: 'admin', outcome: 'allowed' })
  })

  it('refuses a file that is not on the offer here too', async () => {
    const f = await fixture()
    const admin = await staffWith(app, {}, { superadmin: true })
    const stray = await seedReadyAsset(app.pg, { uploaderId: f.merchant.id, uploaderKind: 'merchant' })
    const res = await f.viaStaff(admin.headers, stray)
    expect(res.statusCode).toBe(422)
    expect(res.json().type).toMatch(/\/offers\/media-not-attached$/)
  })

  it('answers an unknown offer with the standard 404', async () => {
    const f = await fixture()
    const admin = await staffWith(app, {}, { superadmin: true })
    expect((await f.viaStaff(admin.headers, f.assets[0]!, randomUUID())).statusCode).toBe(404)
  })
})

describe.skipIf(!hasDatabase)('who may NOT choose an offer’s main media', () => {
  it('staff who hold merchant_offers.edit but are not a super admin are refused, and it is audited', async () => {
    const f = await fixture()
    const before = await f.order()
    const staff = await staffWith(app, { merchant_offers: { edit: true } })
    const res = await f.viaStaff(staff.headers, f.assets[2]!)
    expect(res.statusCode).toBe(403)
    expect(res.json().type).toMatch(/\/insufficient-permission$/)
    // Counter-assertion: the posture gate let them through (they hold the grant); only the handler stopped them.
    expect(await f.order()).toEqual(before)
    const rows = await f.audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'permission_denied', outcome: 'denied', required_permission: 'superadmin' })
  })

  it('staff with no grant are refused', async () => {
    const f = await fixture()
    const before = await f.order()
    const staff = await staffWith(app, {})
    expect((await f.viaStaff(staff.headers, f.assets[2]!)).statusCode).toBe(403)
    expect(await f.order()).toEqual(before)
  })

  it.each(['member', 'partner'] as const)('a %s account cannot use either door', async (kind) => {
    const f = await fixture()
    const before = await f.order()
    const account = await redeemerFor(app, kind)
    for (const res of [await f.viaStaff(account.headers, f.assets[2]!), await f.viaMerchant(account.headers, f.assets[2]!)]) {
      expect(res.statusCode).toBeGreaterThanOrEqual(401)
      expect(res.statusCode).toBeLessThan(500)
    }
    expect(await f.order()).toEqual(before)
  })

  it('a merchant cannot use the staff door', async () => {
    const f = await fixture()
    const before = await f.order()
    const res = await f.viaStaff(f.merchant.headers, f.assets[2]!)
    expect(res.statusCode).toBeGreaterThanOrEqual(401)
    expect(res.statusCode).toBeLessThan(500)
    expect(await f.order()).toEqual(before)
  })

  it('an unauthenticated request is refused at both doors', async () => {
    const f = await fixture()
    expect((await f.viaMerchant({}, f.assets[2]!)).statusCode).toBe(401)
    expect((await f.viaStaff({}, f.assets[2]!)).statusCode).toBe(401)
  })
})
