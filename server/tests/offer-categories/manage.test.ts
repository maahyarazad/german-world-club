import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, staffWith, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, US4: staff see every category with its offer count, and add,
 * rename, reorder, hide and show them. Hiding keeps the category on its offers
 * (still visible and redeemable) and only withholds it from merchants for new
 * ones. There is no delete.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
  await app.pg.query(`DELETE FROM offer_categories WHERE slug LIKE 'test-%'`)
})

const list = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/admin/offer-categories', headers })
const idOf = async (slug: string) => String((await app.pg.query('SELECT id FROM offer_categories WHERE slug = $1', [slug])).rows[0].id)

describe.skipIf(!hasDatabase)('managing categories', () => {
  it('lists the starter set, with offer counts, hidden ones included', async () => {
    const staff = await staffWith(app, { merchant_offers: { read: true } })
    const merchant = await merchantWithStore(app)
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'restaurants' })
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'restaurants', state: 'draft' })
    await app.pg.query(`UPDATE offer_categories SET visible = false WHERE slug = 'education'`)

    const { items } = (await list(staff.headers)).json()
    const slugs = items.map((c: { slug: string }) => c.slug)
    expect(slugs).toEqual(expect.arrayContaining(['restaurants', 'health', 'beauty', 'shopping', 'travel', 'services', 'education', 'other']))
    const bySlug = Object.fromEntries(items.map((c: { slug: string; offerCount: number; visible: boolean }) => [c.slug, c]))
    expect(bySlug.restaurants.offerCount).toBe(2)
    expect(bySlug.education).toMatchObject({ visible: false, offerCount: 0 })
  })

  it('adds a category, appended to the end, and refuses a duplicate slug', async () => {
    const staff = await staffWith(app, { merchant_offers: { write: true, read: true } })
    const created = await app.inject({
      method: 'POST', url: '/admin/offer-categories', headers: staff.headers,
      payload: { slug: 'test-pets', nameDe: 'Haustiere', nameEn: 'Pets' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ slug: 'test-pets', nameDe: 'Haustiere', nameEn: 'Pets', visible: true, offerCount: 0 })

    const items = (await list(staff.headers)).json().items
    expect(items[items.length - 1].slug).toBe('test-pets')

    const again = await app.inject({
      method: 'POST', url: '/admin/offer-categories', headers: staff.headers,
      payload: { slug: 'test-pets', nameDe: 'x', nameEn: 'x' },
    })
    expect(again.statusCode).toBe(409)
  })

  it('refuses a slug that is not lower-case letters, digits and hyphens', async () => {
    const staff = await staffWith(app, { merchant_offers: { write: true } })
    for (const slug of ['Bad Slug', 'x', '1abc', 'UPPER']) {
      const response = await app.inject({
        method: 'POST', url: '/admin/offer-categories', headers: staff.headers, payload: { slug, nameDe: 'x', nameEn: 'x' },
      })
      expect(response.statusCode, slug).toBe(400)
    }
  })

  it('renames, reorders, and hides and shows, auditing each change', async () => {
    const staff = await staffWith(app, { merchant_offers: { edit: true, read: true } })
    const id = await idOf('travel')
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/admin/offer-categories/${id}`, headers: staff.headers, payload })

    expect((await patch({ nameEn: 'Trips' })).json().nameEn).toBe('Trips')
    expect((await patch({ position: 5 })).json().position).toBe(5)
    expect((await patch({ visible: false })).json().visible).toBe(false)
    expect((await patch({ visible: true })).json().visible).toBe(true)

    const { rows } = await app.pg.query(`SELECT detail FROM audit_log WHERE action = 'offer_category_updated' ORDER BY id`)
    expect(rows).toHaveLength(4)
    expect(rows[2].detail.categoryChange).toEqual({ before: { visible: true }, after: { visible: false } })
  })

  it('does not audit a change that changes nothing', async () => {
    const staff = await staffWith(app, { merchant_offers: { edit: true } })
    const id = await idOf('travel')
    await app.inject({ method: 'PATCH', url: `/admin/offer-categories/${id}`, headers: staff.headers, payload: { visible: true } })
    expect(Number((await app.pg.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'offer_category_updated'`)).rows[0].n)).toBe(0)
  })

  it('keeps a hidden category on its offers, still visible and redeemable, and out of the merchant’s choices', async () => {
    const staff = await staffWith(app, { merchant_offers: { edit: true } })
    const merchant = await merchantWithStore(app)
    const offerId = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'beauty' })
    const member = await redeemerFor(app, 'member')
    await app.inject({ method: 'PATCH', url: `/admin/offer-categories/${await idOf('beauty')}`, headers: staff.headers, payload: { visible: false } })

    const detail = await app.inject({ method: 'GET', url: `${CLUB_OFFERS.member}/${offerId}`, headers: member.headers })
    expect(detail.statusCode).toBe(200)
    expect(detail.json().category.slug).toBe('beauty')
    expect((await app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${offerId}/redemptions`, headers: member.headers, payload: { requestId: randomUUID() },
    })).statusCode).toBe(201)

    const choices = (await app.inject({ method: 'GET', url: '/merchant/categories', headers: merchant.headers })).json().items
    expect(choices.map((c: { slug: string }) => c.slug)).not.toContain('beauty')
  })

  it('has no delete route, and the database refuses to drop a category that has offers', async () => {
    const staff = await staffWith(app, { merchant_offers: true })
    const id = await idOf('restaurants')
    const response = await app.inject({ method: 'DELETE', url: `/admin/offer-categories/${id}`, headers: staff.headers })
    expect([404, 405]).toContain(response.statusCode)

    const merchant = await merchantWithStore(app)
    await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, categorySlug: 'restaurants' })
    await expect(app.pg.query('DELETE FROM offer_categories WHERE id = $1', [id])).rejects.toThrow(/offers_category_id_fkey|violates foreign key/)
  })

  it('answers an unknown category with 404', async () => {
    const staff = await staffWith(app, { merchant_offers: { edit: true } })
    expect((await app.inject({ method: 'PATCH', url: `/admin/offer-categories/${randomUUID()}`, headers: staff.headers, payload: { visible: false } })).statusCode).toBe(404)
  })

  it('is refused to a merchant, a member and staff without the matching flag', async () => {
    const merchant = await merchantWithStore(app)
    const member = await redeemerFor(app, 'member')
    const readOnly = await staffWith(app, { merchant_offers: { read: true } })
    const id = await idOf('travel')

    expect((await list(merchant.headers)).statusCode).toBeGreaterThanOrEqual(401)
    expect((await list(member.headers)).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'POST', url: '/admin/offer-categories', headers: readOnly.headers, payload: { slug: 'test-no', nameDe: 'x', nameEn: 'x' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: `/admin/offer-categories/${id}`, headers: readOnly.headers, payload: { visible: false } })).statusCode).toBe(403)
  })
})
