import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace, staffWithModeration } from './helpers.ts'
import { merchantWithStore, seedOffer, resetOffers } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The staff listing browser (feature 037, US3, FR-010, FR-015, SC-007).
 *
 * It lists every member listing in every state and nothing else, never shows a
 * contact detail, and is reachable only with `marketplace_moderation.read`.
 */

describe.skipIf(!hasDatabase)('GET /admin/marketplace/listings', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let staff: Awaited<ReturnType<typeof staffWithModeration>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    staff = await staffWithModeration(app, { read: true })
  })

  const list = (qs = '', headers = staff.headers) =>
    app.inject({ method: 'GET', url: `/admin/marketplace/listings${qs}`, headers })
  const titles = (response: { json(): { items: Array<{ title: string }> } }) => response.json().items.map((i) => i.title)

  it('lists every state, newest first, with the fields the page needs on the wire', async () => {
    const states = ['draft', 'active', 'sold', 'filled', 'withdrawn', 'expired', 'hidden']
    for (const [i, state] of states.entries()) {
      await seedListing(app.pg, { ownerId: owner.id, state, title: `Listing in ${state} ${i}` })
    }
    const response = await list()
    expect(response.statusCode).toBe(200)
    const items = response.json().items as Array<Record<string, unknown>>
    expect(items).toHaveLength(states.length)
    expect(new Set(items.map((i) => i.state))).toEqual(new Set(states))
    // Newest first.
    expect(titles(response)[0]).toBe('Listing in hidden 6')
    // Declared in the response schema, or Zod would have stripped them.
    for (const item of items) {
      expect(item).toHaveProperty('hiddenFromState')
      expect(item).toHaveProperty('openReports')
      expect(item.owner).toMatchObject({ id: owner.id })
    }
  })

  it('shows a disabled listing the state it came from', async () => {
    await seedListing(app.pg, { ownerId: owner.id, state: 'hidden', hiddenFromState: 'draft', published: false })
    const [item] = (await list('?state=hidden')).json().items
    expect(item.hiddenFromState).toBe('draft')
  })

  it('filters by state, category and owner, and searches the title', async () => {
    const second = await poster(app)
    await seedListing(app.pg, { ownerId: owner.id, state: 'draft', title: 'Red bicycle' })
    await seedListing(app.pg, { ownerId: owner.id, state: 'active', category: 'vehicle', title: 'Blue car' })
    await seedListing(app.pg, { ownerId: second.id, state: 'active', title: 'Green bicycle' })

    expect(titles(await list('?state=draft'))).toEqual(['Red bicycle'])
    expect(titles(await list('?category=vehicle'))).toEqual(['Blue car'])
    expect(titles(await list(`?ownerId=${second.id}`))).toEqual(['Green bicycle'])
    expect((titles(await list('?q=BICYCLE'))).sort()).toEqual(['Green bicycle', 'Red bicycle'])
    // The counter-assertion: no filter returns all three.
    expect(titles(await list())).toHaveLength(3)
  })

  it('searches for a literal % and _, not as wildcards', async () => {
    await seedListing(app.pg, { ownerId: owner.id, title: 'Half price 50% off' })
    await seedListing(app.pg, { ownerId: owner.id, title: 'Fifty percent sale' })
    await seedListing(app.pg, { ownerId: owner.id, title: 'Item_one' })
    await seedListing(app.pg, { ownerId: owner.id, title: 'ItemXone' })
    expect(titles(await list('?q=50%25'))).toEqual(['Half price 50% off'])
    expect(titles(await list('?q=m_o'))).toEqual(['Item_one'])
  })

  it('pages with a cursor without repeating or skipping a row', async () => {
    for (let i = 0; i < 7; i += 1) await seedListing(app.pg, { ownerId: owner.id, title: `Paged listing ${i}` })
    const seen: string[] = []
    let cursor: string | null = null
    for (let page = 0; page < 5; page += 1) {
      const response = await list(`?limit=3${cursor ? `&cursor=${cursor}` : ''}`)
      seen.push(...titles(response))
      cursor = response.json().nextCursor
      if (!cursor) break
    }
    expect(seen).toHaveLength(7)
    expect(new Set(seen).size).toBe(7)
  })

  it('bounds the limit in the handler and refuses an unreadable cursor with 400', async () => {
    for (let i = 0; i < 3; i += 1) await seedListing(app.pg, { ownerId: owner.id })
    expect((await list('?limit=1000000')).statusCode).toBe(200)
    expect((await list('?cursor=not-a-cursor')).statusCode).toBe(400)
  })

  it('never contains a merchant offer', async () => {
    // A real merchant offer, published, in the same database. The counter-
    // assertion is that it exists and the member listing is still the only row.
    await resetOffers(app.pg)
    const merchant = await merchantWithStore(app)
    await seedOffer(app.pg, {
      organisationId: merchant.organisationId, storeId: merchant.storeId, title: 'A merchant offer',
    })
    expect((await app.pg.query(`SELECT 1 FROM offers WHERE title = 'A merchant offer'`)).rows).toHaveLength(1)

    await seedListing(app.pg, { ownerId: owner.id, title: 'A member listing' })
    expect(titles(await list())).toEqual(['A member listing'])
  })

  describe('who may read it (FR-015)', () => {
    it('refuses a member', async () => {
      expect((await list('', owner.headers)).statusCode).toBeGreaterThanOrEqual(401)
    })
    it('refuses staff without the read grant, and the granted staff succeeds', async () => {
      const without = await staffWithModeration(app, { status: true })
      expect((await list('', without.headers)).statusCode).toBe(403)
      expect((await list()).statusCode).toBe(200)
    })
    it('is not a way to see unauthenticated', async () => {
      expect((await app.inject({ method: 'GET', url: '/admin/marketplace/listings' })).statusCode).toBe(401)
    })
  })

  describe('what it never shows (Principle VI)', () => {
    it('carries no contact detail, body text or storage key for the owner or the listing', async () => {
      const member = await createMember(app.pg, { email: 'private-owner@test.invalid' })
      await app.pg.query('INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)', [member.id, 'v1'])
      await bearerFor(app, { accountId: member.id, accountKind: 'member' })
      await seedListing(app.pg, { ownerId: String(member.id), title: 'Visible title' })

      const body = (await list()).body
      expect(body).toContain('Visible title')
      expect(body).not.toMatch(/private-owner@test\.invalid/)
      expect(body).not.toMatch(/"(email|mobile|phone|legalName|legal_name|contact|body|storageKey|storage_key)"/i)
    })
  })

  it('adds nothing a staff member can use to change what a member wrote', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, title: 'Written by the member' })
    const all = await staffWithModeration(app, true)
    for (const method of ['PATCH', 'PUT', 'POST'] as const) {
      const response = await app.inject({
        method, url: `/admin/marketplace/listings/${id}`, headers: all.headers, payload: { title: 'Staff rewrite' },
      })
      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    }
    expect((await app.pg.query('SELECT title FROM marketplace_listings WHERE id = $1', [id])).rows[0].title).toBe('Written by the member')
  })
})
