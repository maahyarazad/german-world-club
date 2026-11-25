import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, seedReadyAsset, redeemerFor, resetOffers, CLUB_OFFERS } from './helpers.ts'
import type { RedeemerKind } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-012 and FR-004: browsing merchant offers by category, the same
 * for every kind of account. Thumbnails only, and a deactivated store, a
 * suspended organisation or a hidden state vanishes from the list on the next
 * request.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const list = async (headers: Record<string, string>, query = '', prefix = CLUB_OFFERS.member) =>
  app.inject({ method: 'GET', url: `${prefix}${query}`, headers })

describe.skipIf(!hasDatabase)('browsing merchant offers', () => {
  it('lists visible offers and filters by category', async () => {
    const merchant = await merchantWithStore(app)
    const food = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'restaurants', title: 'Essen' })
    const clinic = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'health', title: 'Klinik' })
    const member = await redeemerFor(app, 'member')

    const all = (await list(member.headers)).json()
    expect(all.items.map((i: { id: string }) => i.id).sort()).toEqual([food, clinic].sort())

    const { rows } = await app.pg.query(`SELECT id FROM offer_categories WHERE slug = 'health'`)
    const onlyClinic = (await list(member.headers, `?categoryId=${rows[0].id}`)).json()
    expect(onlyClinic.items.map((i: { id: string }) => i.id)).toEqual([clinic])
  })

  it.each(['member', 'admin', 'merchant', 'partner'] as const)('serves the same list to a %s account', async (kind: RedeemerKind) => {
    const merchant = await merchantWithStore(app)
    const offer = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
    const account = await redeemerFor(app, kind)
    const response = await list(account.headers, '', CLUB_OFFERS[kind])
    expect(response.statusCode).toBe(200)
    expect(response.json().items.map((i: { id: string }) => i.id)).toEqual([offer])
  })

  it('leaves out drafts, withdrawn, expired and not-yet-started offers, and a deactivated store’s', async () => {
    const merchant = await merchantWithStore(app)
    const DAY = 86_400_000
    const live = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
    for (const state of ['draft', 'withdrawn']) await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, state })
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, validFrom: new Date(Date.now() - 9 * DAY), validUntil: new Date(Date.now() - DAY) })
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, validFrom: new Date(Date.now() + DAY), validUntil: new Date(Date.now() + 9 * DAY) })
    const closed = await merchantWithStore(app, { storeActive: false })
    await seedOffer(app.pg, { organisationId: closed.organisationId, storeId: closed.storeId })
    const suspended = await merchantWithStore(app, { orgStatus: 'suspended' })
    await seedOffer(app.pg, { organisationId: suspended.organisationId, storeId: suspended.storeId })

    const member = await redeemerFor(app, 'member')
    expect((await list(member.headers)).json().items.map((i: { id: string }) => i.id)).toEqual([live])
  })

  it('shows a sold-out offer as sold out rather than hiding it', async () => {
    const merchant = await merchantWithStore(app)
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, remaining: 0 })
    const member = await redeemerFor(app, 'member')
    const [item] = (await list(member.headers)).json().items
    expect(item.soldOut).toBe(true)
  })

  it('sends a derivative of the lead image and never an original', async () => {
    const merchant = await merchantWithStore(app)
    const offer = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
    const asset = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })
    await app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, 0)', [offer, asset])
    const member = await redeemerFor(app, 'member')

    const response = await list(member.headers)
    const [item] = response.json().items
    expect(item.thumbnail.assetId).toBe(asset)
    expect(item.thumbnail.variants[0].url).toMatch(/^\/media\/[0-9a-f]{64}\/thumb\.webp$/)
    expect(response.body).not.toContain('test/')
    expect(response.body).not.toMatch(/storage_?key|legal_?name|fee_?tier/i)
  })

  it('pages by keyset without repeating or skipping an offer', async () => {
    const merchant = await merchantWithStore(app)
    const ids: string[] = []
    for (let i = 0; i < 25; i += 1) {
      ids.push(await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, title: `Offer ${i}` }))
    }
    const member = await redeemerFor(app, 'member')
    const first = (await list(member.headers)).json()
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).not.toBeNull()
    const second = (await list(member.headers, `?cursor=${encodeURIComponent(first.nextCursor)}`)).json()
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    const seen = [...first.items, ...second.items].map((i: { id: string }) => i.id)
    expect(new Set(seen).size).toBe(25)
    expect(seen.sort()).toEqual(ids.sort())
  })

  it('lists categories with a live count, keeping a hidden one that still has offers', async () => {
    const merchant = await merchantWithStore(app)
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'restaurants' })
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'travel' })
    await app.pg.query(`UPDATE offer_categories SET visible = false WHERE slug IN ('travel', 'beauty')`)
    const member = await redeemerFor(app, 'member')

    const { items } = (await list(member.headers, '', `${CLUB_OFFERS.member}/categories` as never)).json()
    const bySlug = Object.fromEntries(items.map((c: { slug: string; offerCount: number }) => [c.slug, c.offerCount]))
    expect(bySlug.restaurants).toBe(1)
    // Hidden but still has a visible offer: shown, so the offer can be found.
    expect(bySlug.travel).toBe(1)
    // Hidden and empty: gone. Visible and empty: still there, at zero.
    expect(bySlug).not.toHaveProperty('beauty')
    expect(bySlug.health).toBe(0)
  })
})
