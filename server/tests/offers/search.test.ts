import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers, CLUB_OFFERS } from './helpers.ts'
import type { RedeemerKind } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 042, US4 (FR-019 to FR-024): text search in the offers' titles and
 * descriptions, evaluated on the server over everything the requester may see.
 *
 * The visibility cases are the ones that matter. A search predicate is only ever
 * ANDed after `VISIBLE_OFFER`; if it were an OR, or ran before it, a draft or a
 * switched-off store's offer containing the typed word would surface. Each is
 * therefore paired with a visible offer that matches too, so "absent" cannot pass
 * by the search simply returning nothing.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const DAY = 86_400_000

async function shop() {
  const merchant = await merchantWithStore(app)
  const member = await redeemerFor(app, 'member')
  const offer = async (
    title: string, description: string | null = null,
    extra: Parameters<typeof seedOffer>[1] extends infer S ? Partial<S> : never = {},
  ) => {
    const id = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId, title, ...extra })
    await app.pg.query('UPDATE offers SET description = $2 WHERE id = $1', [id, description])
    return id
  }
  const search = async (q: string, { query = '', headers = member.headers, prefix = CLUB_OFFERS.member } = {}) =>
    app.inject({ method: 'GET', url: `${prefix}?q=${encodeURIComponent(q)}${query}`, headers })
  const ids = async (q: string, options = {}) => {
    const res = await search(q, options)
    expect(res.statusCode).toBe(200)
    return (res.json().items as { id: string }[]).map((i) => i.id)
  }
  return { merchant, member, offer, search, ids }
}

describe.skipIf(!hasDatabase)('searching merchant offers', () => {
  it('finds an offer by its title, and by its description alone, and not one that has neither', async () => {
    const s = await shop()
    const inTitle = await s.offer('Pizza Margherita')
    const inDescription = await s.offer('Mittagstisch', 'Dazu gibt es Pizza für alle')
    await s.offer('Kaffee', 'Frisch gebrüht')
    expect((await s.ids('pizza')).sort()).toEqual([inTitle, inDescription].sort())
  })

  it('ignores case and matches part of a word', async () => {
    const s = await shop()
    const id = await s.offer('Fahrradhelm')
    await s.offer('Kaffee')
    expect(await s.ids('RAD')).toEqual([id])
    expect(await s.ids('helm')).toEqual([id])
    expect(await s.ids('FAHRRADHELM')).toEqual([id])
  })

  it('needs every word, each in the title or the description', async () => {
    const s = await shop()
    const both = await s.offer('Pizza Rabatt')
    await s.offer('Pizza Spezial')
    await s.offer('Rabatt Kaffee')
    expect(await s.ids('pizza rabatt')).toEqual([both])
    // A word in the title and another only in the description still matches.
    const split = await s.offer('Zwei Kaffee', 'Montags geöffnet')
    expect(await s.ids('kaffee montags')).toEqual([split])
  })

  it('is not fooled by a description that is missing', async () => {
    const s = await shop()
    const noDescription = await s.offer('Kaffee', null)
    expect(await s.ids('kaffee')).toEqual([noDescription])
    expect(await s.ids('beschreibung')).toEqual([])
  })

  it('combines with the category the person already chose', async () => {
    const s = await shop()
    const food = await s.offer('Pizza essen', null, { categorySlug: 'restaurants' })
    await s.offer('Pizza Klinik', null, { categorySlug: 'health' })
    const { rows } = await app.pg.query(`SELECT id FROM offer_categories WHERE slug = 'restaurants'`)
    expect(await s.ids('pizza', { query: `&categoryId=${rows[0].id}` })).toEqual([food])
    expect(await s.ids('pizza')).toHaveLength(2)
  })

  it('matches % and _ as themselves, not as wildcards', async () => {
    const s = await shop()
    const percent = await s.offer('50% Rabatt')
    await s.offer('500 Rabatt')
    expect(await s.ids('50%')).toEqual([percent])
    const underscore = await s.offer('a_b Test')
    await s.offer('axb Test')
    expect(await s.ids('a_b')).toEqual([underscore])
  })

  it('treats an empty search as no search at all', async () => {
    const s = await shop()
    const a = await s.offer('Pizza')
    const b = await s.offer('Kaffee')
    expect((await s.ids('')).sort()).toEqual([a, b].sort())
    expect((await s.ids('   ')).sort()).toEqual([a, b].sort())
  })

  it('pages by the same cursor, and every match is reachable across pages', async () => {
    const s = await shop()
    const matches: string[] = []
    for (let i = 0; i < 22; i++) matches.push(await s.offer(`Kaffee ${String(i).padStart(2, '0')}`))
    await s.offer('Pizza')

    const first = (await s.search('kaffee')).json()
    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toEqual(expect.any(String))
    const second = (await s.search('kaffee', { query: `&cursor=${encodeURIComponent(first.nextCursor)}` })).json()
    expect(second.items).toHaveLength(2)
    expect(second.nextCursor).toBeNull()

    const all = [...first.items, ...second.items].map((i: { id: string }) => i.id)
    expect(new Set(all).size).toBe(22)
    expect(all.sort()).toEqual(matches.sort())
  })

  it('answers with exactly the shape of the unfiltered list: no new fields', async () => {
    const s = await shop()
    await s.offer('Pizza')
    const plain = (await app.inject({ method: 'GET', url: CLUB_OFFERS.member, headers: s.member.headers })).json()
    const searched = (await s.search('pizza')).json()
    expect(Object.keys(searched).sort()).toEqual(Object.keys(plain).sort())
    expect(Object.keys(searched.items[0]).sort()).toEqual(Object.keys(plain.items[0]).sort())
  })

  it.each(['member', 'admin', 'merchant', 'partner'] as const)('works the same for a %s account', async (kind: RedeemerKind) => {
    const s = await shop()
    const id = await s.offer('Pizza Margherita')
    await s.offer('Kaffee')
    const account = await redeemerFor(app, kind)
    expect(await s.ids('pizza', { headers: account.headers, prefix: CLUB_OFFERS[kind] })).toEqual([id])
  })
})

describe.skipIf(!hasDatabase)('a search never reveals what the list hides', () => {
  it('leaves out drafts, withdrawn, expired and not-yet-started offers that contain the word', async () => {
    const s = await shop()
    const visible = await s.offer('Zebra Kaffee')
    await s.offer('Zebra Entwurf', null, { state: 'draft' })
    await s.offer('Zebra zurückgezogen', null, { state: 'withdrawn' })
    await s.offer('Zebra abgelaufen', null, { validFrom: new Date(Date.now() - 9 * DAY), validUntil: new Date(Date.now() - DAY) })
    await s.offer('Zebra bald', null, { validFrom: new Date(Date.now() + 5 * DAY), validUntil: new Date(Date.now() + 9 * DAY) })
    await s.offer('Kaffee ohne', 'Zebra nur in der Beschreibung', { state: 'draft' })
    expect(await s.ids('zebra')).toEqual([visible])
  })

  it('leaves out an offer from a store that staff switched off, and from a suspended organisation', async () => {
    const s = await shop()
    const visible = await s.offer('Zebra Kaffee')
    const off = await merchantWithStore(app, { storeActive: false, displayName: 'Aus' })
    await seedOffer(app.pg, { organisationId: off.organisationId, storeId: off.storeId, title: 'Zebra im geschlossenen Laden' })
    const suspended = await merchantWithStore(app, { orgStatus: 'suspended', displayName: 'Gesperrt' })
    await seedOffer(app.pg, { organisationId: suspended.organisationId, storeId: suspended.storeId, title: 'Zebra gesperrt' })
    expect(await s.ids('zebra')).toEqual([visible])
  })

  it('stops showing an offer on the very next request once its store is switched off', async () => {
    const s = await shop()
    const id = await s.offer('Zebra Kaffee')
    expect(await s.ids('zebra')).toEqual([id])
    await app.pg.query('UPDATE stores SET active = false, deactivated_at = now(), deactivation_reason = $2 WHERE id = $1', [s.merchant.storeId, 'test'])
    expect(await s.ids('zebra')).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('refusing a search that is out of bounds', () => {
  const problemType = (res: { json(): { type: string } }) => res.json().type
  it.each([
    ['one character', 'a'],
    ['81 characters', 'x'.repeat(81)],
    ['seven words', 'a1 b2 c3 d4 e5 f6 g7'],
  ])('refuses %s with 400 validation-failed', async (_label, q) => {
    const s = await shop()
    await s.offer('Pizza')
    const res = await s.search(q)
    expect(res.statusCode).toBe(400)
    expect(problemType(res)).toMatch(/\/validation-failed$/)
  })

  it('accepts the bounds themselves: two characters, 80 characters, six words', async () => {
    const s = await shop()
    for (const q of ['ab', 'x'.repeat(80), 'a1 b2 c3 d4 e5 f6']) expect((await s.search(q)).statusCode).toBe(200)
  })
})
