import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035: a merchant's offers, from draft to published to withdrawn.
 * Category required, the three types, the real-advantage rule, direct
 * publishing, and the refusals that keep an offer from going out unseeable.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const DAY = 86_400_000
const window = () => ({
  validFrom: new Date(Date.now() - DAY).toISOString(),
  validUntil: new Date(Date.now() + 30 * DAY).toISOString(),
})

async function category(slug = 'restaurants') {
  const { rows } = await app.pg.query('SELECT id FROM offer_categories WHERE slug = $1', [slug])
  return String(rows[0].id)
}

const draft = async (merchant: { headers: Record<string, string> }, overrides: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST', url: '/merchant/offers', headers: merchant.headers,
    payload: {
      title: 'Zwei Kaffee', categoryId: await category(), benefitKind: 'percentage', benefitValue: 20,
      regularPriceCents: 1000, memberPriceCents: 800, ...window(), ...overrides,
    },
  })

const asMember = async () => (await redeemerFor(app, 'member')).headers
const memberGet = async (id: string) =>
  app.inject({ method: 'GET', url: `/member/offers/${id}`, headers: await asMember() })

describe.skipIf(!hasDatabase)('creating an offer', () => {
  it('creates a draft that carries its category', async () => {
    const merchant = await merchantWithStore(app)
    const response = await draft(merchant)
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ state: 'draft', title: 'Zwei Kaffee', perPersonLimit: 1, publishedAt: null })
    expect(response.json().categoryId).toBe(await category())
  })

  it('refuses an offer with no category, naming the problem', async () => {
    const merchant = await merchantWithStore(app)
    const response = await draft(merchant, { categoryId: undefined })
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toContain('category-required')
  })

  it('refuses a hidden category for a new offer, but not an unrelated edit of an offer already under it', async () => {
    const merchant = await merchantWithStore(app)
    const created = (await draft(merchant)).json()
    await app.pg.query(`UPDATE offer_categories SET visible = false WHERE slug = 'restaurants'`)

    const refused = await draft(merchant)
    expect(refused.statusCode).toBe(422)

    const edit = await app.inject({
      method: 'PATCH', url: `/merchant/offers/${created.id}`, headers: merchant.headers,
      payload: { version: created.version, title: 'Umbenannt' },
    })
    expect(edit.statusCode).toBe(200)
    expect(edit.json().title).toBe('Umbenannt')
    expect(edit.json().categoryId).toBe(created.categoryId)
  })

  it.each(['freebie', 'bogo'])('accepts a %s offer with no price and no value', async (kind) => {
    const merchant = await merchantWithStore(app)
    const response = await draft(merchant, {
      benefitKind: kind, benefitValue: null, regularPriceCents: null, memberPriceCents: null,
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().benefit).toEqual({ kind, value: null })
  })

  it('refuses a freebie that carries a discount figure', async () => {
    const merchant = await merchantWithStore(app)
    const response = await draft(merchant, { benefitKind: 'freebie', benefitValue: 50 })
    expect(response.statusCode).toBe(400)
  })

  it('keeps the real-advantage rule: a member price that is not lower is refused', async () => {
    const merchant = await merchantWithStore(app)
    expect((await draft(merchant, { regularPriceCents: 1000, memberPriceCents: 1000 })).statusCode).toBe(400)
    // Counter-assertion: one cent lower is a real advantage.
    expect((await draft(merchant, { regularPriceCents: 1000, memberPriceCents: 999 })).statusCode).toBe(201)
  })

  it('refuses a percentage outside 1-100 and an offer that ends before it starts', async () => {
    const merchant = await merchantWithStore(app)
    expect((await draft(merchant, { benefitValue: 150 })).statusCode).toBe(400)
    expect((await draft(merchant, { validFrom: new Date(Date.now() + DAY).toISOString(), validUntil: new Date().toISOString() })).statusCode).toBe(400)
  })

  it('refuses an organisation with no store yet', async () => {
    const merchant = await merchantWithStore(app, { createStore: false })
    const response = await draft(merchant)
    expect(response.statusCode).toBe(404)
    expect(response.json().type).toContain('store-not-found')
  })

  it('defaults to one per person, and an explicit null means no limit', async () => {
    const merchant = await merchantWithStore(app)
    expect((await draft(merchant)).json().perPersonLimit).toBe(1)
    expect((await draft(merchant, { perPersonLimit: null })).json().perPersonLimit).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('publishing and withdrawing', () => {
  it('publishes straight away, with no approval step, and members then see it', async () => {
    const merchant = await merchantWithStore(app)
    const created = (await draft(merchant)).json()
    expect((await memberGet(created.id)).statusCode).toBe(404)

    const published = await app.inject({ method: 'POST', url: `/merchant/offers/${created.id}/publish`, headers: merchant.headers })
    expect(published.statusCode).toBe(200)
    expect(published.json().state).toBe('published')
    expect(published.json().publishedAt).not.toBeNull()
    expect((await memberGet(created.id)).statusCode).toBe(200)
  })

  it('hides a withdrawn offer from members, and can publish it again', async () => {
    const merchant = await merchantWithStore(app)
    const id = (await draft(merchant)).json().id
    await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })

    const withdrawn = await app.inject({ method: 'POST', url: `/merchant/offers/${id}/withdraw`, headers: merchant.headers })
    expect(withdrawn.json().state).toBe('withdrawn')
    expect((await memberGet(id)).statusCode).toBe(404)

    const again = await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })
    expect(again.json().state).toBe('published')
  })

  it('treats a repeated publish or withdraw as a no-op rather than an error', async () => {
    const merchant = await merchantWithStore(app)
    const id = (await draft(merchant)).json().id
    await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })
    expect((await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })).statusCode).toBe(200)
    await app.inject({ method: 'POST', url: `/merchant/offers/${id}/withdraw`, headers: merchant.headers })
    expect((await app.inject({ method: 'POST', url: `/merchant/offers/${id}/withdraw`, headers: merchant.headers })).statusCode).toBe(200)
  })

  it('has nothing to withdraw on a draft', async () => {
    const merchant = await merchantWithStore(app)
    const id = (await draft(merchant)).json().id
    expect((await app.inject({ method: 'POST', url: `/merchant/offers/${id}/withdraw`, headers: merchant.headers })).statusCode).toBe(409)
  })

  it('refuses to publish while the store is switched off', async () => {
    const merchant = await merchantWithStore(app)
    const id = (await draft(merchant)).json().id
    await app.pg.query(
      `UPDATE stores SET active = false, deactivated_at = now(), deactivation_reason = 'test' WHERE id = $1`, [merchant.storeId],
    )
    const response = await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toContain('store-inactive')
  })

  it('refuses to publish for a merchant with no public name, rather than announcing something nobody can see', async () => {
    const merchant = await merchantWithStore(app, { profile: false })
    const id = (await draft(merchant)).json().id
    const response = await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toContain('profile-incomplete')
    const { rows } = await app.pg.query('SELECT state FROM offers WHERE id = $1', [id])
    expect(rows[0].state).toBe('draft')
  })

  it('refuses to publish an offer whose window is already over', async () => {
    const merchant = await merchantWithStore(app)
    const id = await seedOffer(app.pg, {
      organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft',
      validFrom: new Date(Date.now() - 10 * DAY), validUntil: new Date(Date.now() - DAY),
    })
    expect((await app.inject({ method: 'POST', url: `/merchant/offers/${id}/publish`, headers: merchant.headers })).statusCode).toBe(400)
  })
})

describe.skipIf(!hasDatabase)('editing', () => {
  it('refuses a stale edit with 409 and keeps the other user’s change', async () => {
    const merchant = await merchantWithStore(app)
    const created = (await draft(merchant)).json()
    const first = await app.inject({
      method: 'PATCH', url: `/merchant/offers/${created.id}`, headers: merchant.headers,
      payload: { version: created.version, title: 'Von Nutzer A' },
    })
    expect(first.statusCode).toBe(200)

    const stale = await app.inject({
      method: 'PATCH', url: `/merchant/offers/${created.id}`, headers: merchant.headers,
      payload: { version: created.version, title: 'Von Nutzer B' },
    })
    expect(stale.statusCode).toBe(409)
    const list = (await app.inject({ method: 'GET', url: '/merchant/offers', headers: merchant.headers })).json()
    expect(list.items[0].title).toBe('Von Nutzer A')
  })

  it('orders the merchant’s own offers, and refuses an order that names someone else’s', async () => {
    const merchant = await merchantWithStore(app)
    const a = (await draft(merchant, { title: 'A' })).json().id
    const b = (await draft(merchant, { title: 'B' })).json().id

    const ordered = await app.inject({ method: 'PUT', url: '/merchant/offers/order', headers: merchant.headers, payload: { ids: [b, a] } })
    expect(ordered.json().items.map((o: { title: string }) => o.title)).toEqual(['B', 'A'])

    const other = await merchantWithStore(app)
    const theirs = await seedOffer(app.pg, { organisationId: other.organisationId, storeId: other.storeId })
    const refused = await app.inject({ method: 'PUT', url: '/merchant/offers/order', headers: merchant.headers, payload: { ids: [a, theirs] } })
    expect(refused.statusCode).toBe(404)
  })

  it('lists the categories a merchant may choose, without the hidden ones', async () => {
    const merchant = await merchantWithStore(app)
    await app.pg.query(`UPDATE offer_categories SET visible = false WHERE slug = 'other'`)
    const response = await app.inject({ method: 'GET', url: '/merchant/categories', headers: merchant.headers })
    const slugs = response.json().items.map((c: { slug: string }) => c.slug)
    expect(slugs).toContain('restaurants')
    expect(slugs).not.toContain('other')
  })
})
