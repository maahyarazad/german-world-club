import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 042, US4: text search in the marketplace listings' titles and
 * descriptions (a listing's description is its `body`).
 *
 * Two traps are pinned here. `q` must be a reserved query key, or the controller
 * reads it as a category-specific filter and answers 400 "'q' is not a filter";
 * and adding it must not have made *unknown* filters acceptable. And a search is
 * only ever ANDed after "active listing, active owner": every non-visible state
 * is asserted absent next to a visible match, so "absent" cannot pass by the
 * search simply returning nothing.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetMarketplace(app.pg)
  await resetAuthTables(app.pg)
})

async function market() {
  const owner = await poster(app)
  const reader = await poster(app)
  const listing = async (
    title: string, body: string | null = null,
    extra: Omit<Parameters<typeof seedListing>[1], 'ownerId' | 'title'> & { ownerId?: string } = {},
  ) => {
    const id = await seedListing(app.pg, { ownerId: owner.id, title, ...extra })
    if (body !== null) await app.pg.query('UPDATE marketplace_listings SET body = $2 WHERE id = $1', [id, body])
    return id
  }
  const get = (query: string, headers: Record<string, string> = reader.headers as never) =>
    app.inject({ method: 'GET', url: `/marketplace/listings?${query}`, headers })
  const ids = async (query: string) => {
    const res = await get(query)
    expect(res.statusCode, res.body).toBe(200)
    return (res.json().items as { id: string }[]).map((i) => i.id)
  }
  const q = (text: string, rest = '') => `q=${encodeURIComponent(text)}${rest}`
  return { owner, reader, listing, get, ids, q }
}

describe.skipIf(!hasDatabase)('searching the marketplace', () => {
  it('is not read as a category filter: q answers 200, not "q is not a filter"', async () => {
    const m = await market()
    await m.listing('Fahrrad')
    const res = await m.get(m.q('rad'))
    expect(res.statusCode).toBe(200)
  })

  it('still refuses a filter that really is unknown (the counter-assertion to the above)', async () => {
    const m = await market()
    const res = await m.get('nonsense=1')
    expect(res.statusCode).toBe(400)
    expect(res.json().type).toMatch(/\/validation-failed$/)
  })

  it('finds a listing by its title, and by its description alone, and not one with neither', async () => {
    const m = await market()
    const inTitle = await m.listing('Zebra Plüschtier')
    const inBody = await m.listing('Kinderspielzeug', 'Ein schönes Zebra aus Holz, kaum benutzt')
    await m.listing('Sofa', 'Bequem und gepflegt, abzuholen')
    expect((await m.ids(m.q('zebra'))).sort()).toEqual([inTitle, inBody].sort())
  })

  it('ignores case and matches part of a word', async () => {
    const m = await market()
    const id = await m.listing('Kinderfahrrad')
    await m.listing('Sofa')
    expect(await m.ids(m.q('RAD'))).toEqual([id])
    expect(await m.ids(m.q('kinder'))).toEqual([id])
  })

  it('needs every word, each in the title or the body', async () => {
    const m = await market()
    const both = await m.listing('Rotes Fahrrad', 'Gut erhalten')
    await m.listing('Rotes Sofa', 'Gut erhalten')
    await m.listing('Blaues Fahrrad', 'Neu und unbenutzt')
    expect(await m.ids(m.q('rotes fahrrad'))).toEqual([both])
    expect(await m.ids(m.q('fahrrad erhalten'))).toEqual([both])
  })

  it('combines with the category and the mode that are already chosen', async () => {
    const m = await market()
    const car = await m.listing('Zebra Auto', null, { category: 'vehicle', mode: 'offer' })
    await m.listing('Zebra Sofa', null, { category: 'general', mode: 'offer' })
    await m.listing('Zebra Gesuch', null, { category: 'vehicle', mode: 'request' })
    expect(await m.ids(m.q('zebra', '&category=vehicle&mode=offer'))).toEqual([car])
    expect(await m.ids(m.q('zebra'))).toHaveLength(3)
  })

  it('matches % and _ as themselves', async () => {
    const m = await market()
    const percent = await m.listing('Nur 50% Anzahlung')
    await m.listing('Nur 500 Anzahlung')
    expect(await m.ids(m.q('50%'))).toEqual([percent])
  })

  it('pages with the same cursor, and every match is reachable across pages', async () => {
    const m = await market()
    const matches: string[] = []
    for (let i = 0; i < 22; i++) matches.push(await m.listing(`Fahrrad ${String(i).padStart(2, '0')}`))
    await m.listing('Sofa')

    const first = (await m.get(m.q('fahrrad'))).json()
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = (await m.get(m.q('fahrrad', `&cursor=${encodeURIComponent(first.nextCursor)}`))).json()
    expect(second.items).toHaveLength(2)
    expect(second.nextCursor).toBeNull()
    const all = [...first.items, ...second.items].map((i: { id: string }) => i.id)
    expect(new Set(all).size).toBe(22)
    expect(all.sort()).toEqual(matches.sort())
  })

  it('treats an empty search as no search', async () => {
    const m = await market()
    const a = await m.listing('Fahrrad')
    const b = await m.listing('Sofa')
    expect((await m.ids('q=')).sort()).toEqual([a, b].sort())
  })
})

describe.skipIf(!hasDatabase)('a marketplace search never reveals what browsing hides', () => {
  it('leaves out drafts, hidden, withdrawn and expired listings that contain the word', async () => {
    const m = await market()
    const visible = await m.listing('Zebra sichtbar')
    await m.listing('Zebra Entwurf', null, { state: 'draft' })
    await m.listing('Zebra versteckt', null, { state: 'hidden' })
    await m.listing('Zebra zurückgezogen', null, { state: 'withdrawn' })
    await m.listing('Zebra abgelaufen', null, { state: 'expired' })
    await m.listing('Kinderspielzeug', 'Zebra nur im Text', { state: 'draft' })
    expect(await m.ids(m.q('zebra'))).toEqual([visible])
  })

  it('leaves out an active listing whose owner is locked', async () => {
    const m = await market()
    const visible = await m.listing('Zebra sichtbar')
    const locked = await poster(app, { status: 'locked' })
    await seedListing(app.pg, { ownerId: locked.id, title: 'Zebra gesperrter Anbieter' })
    expect(await m.ids(m.q('zebra'))).toEqual([visible])
  })
})

describe.skipIf(!hasDatabase)('who may search, and how much', () => {
  it('refuses an unauthenticated search: this is not a public route', async () => {
    const m = await market()
    await m.listing('Fahrrad')
    expect((await m.get(m.q('rad'), {})).statusCode).toBe(401)
  })

  it.each([
    ['one character', 'a'],
    ['81 characters', 'x'.repeat(81)],
    ['seven words', 'a1 b2 c3 d4 e5 f6 g7'],
  ])('refuses %s with 400 validation-failed', async (_label, text) => {
    const m = await market()
    const res = await m.get(m.q(text))
    expect(res.statusCode).toBe(400)
    expect(res.json().type).toMatch(/\/validation-failed$/)
  })

  it('does not change the public marketplace page, which shows aggregate counts only', async () => {
    const m = await market()
    await m.listing('Zebra Plüschtier')
    const res = await app.inject({ method: 'GET', url: '/marktplatz?q=zebra' })
    // Whether it redirects to the canonical address or serves it, no listing text appears.
    expect([200, 301, 302, 308]).toContain(res.statusCode)
    expect(res.body).not.toContain('Zebra')
    expect(String(res.headers.location ?? '')).not.toContain('q=')
  })
})
