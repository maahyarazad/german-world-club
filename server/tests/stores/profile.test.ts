import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, redeemerFor, seedReadyAsset, resetOffers, CLUB_OFFERS } from '../offers/helpers.ts'
import type { RedeemerKind } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The store behind an offer, seen by another account: `GET <prefix>/stores/:slug`
 * on every club-offers mount. It shows the wide cover, the description, the
 * opening hours and the gallery; it answers one identical 404 for an unknown
 * slug, a store staff switched off and an organisation with no public face; and
 * it never carries contract data.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const slugOf = async (organisationId: string) =>
  String((await app.pg.query('SELECT slug FROM organisations WHERE id = $1', [organisationId])).rows[0].slug)
const view = (kind: RedeemerKind, headers: Record<string, string>, slug: string) =>
  app.inject({ method: 'GET', url: `${CLUB_OFFERS[kind]}/stores/${slug}`, headers })

async function storeWithContent() {
  const merchant = await merchantWithStore(app, { displayName: 'Café Berlin' })
  const cover = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })
  const photo = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })
  await app.pg.query(
    'UPDATE stores SET description = $2, opening_hours = $3, cover_asset_id = $4 WHERE id = $1',
    [merchant.storeId, 'Kaffee und Kuchen seit 1990.', 'Mo–Fr 8–18 Uhr', cover],
  )
  await app.pg.query('INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, 0)', [merchant.storeId, photo])
  return { merchant, slug: await slugOf(merchant.organisationId) }
}

describe.skipIf(!hasDatabase)('viewing a merchant store', () => {
  it.each(['member', 'merchant', 'partner', 'admin'] as const)('shows the store to a %s account', async (kind) => {
    const { slug } = await storeWithContent()
    const viewer = await redeemerFor(app, kind)
    const response = await view(kind, viewer.headers, slug)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body).toMatchObject({
      displayName: 'Café Berlin', slug,
      description: 'Kaffee und Kuchen seit 1990.', openingHours: 'Mo–Fr 8–18 Uhr',
    })
    expect(body.cover).not.toBeNull()
    expect(body.media).toHaveLength(1)
  })

  it('carries no contract data, no storage key, and no state of the store itself', async () => {
    const { slug } = await storeWithContent()
    const member = await redeemerFor(app, 'member')
    const text = (await view('member', member.headers, slug)).body
    for (const forbidden of ['legal_name', 'legalName', 'fee_tier', 'feeTier', 'storage_key', 'storageKey', 'version', 'active', 'organisationId']) {
      expect(text).not.toContain(forbidden)
    }
  })

  it('shows null, not an invented value, for a store with nothing filled in', async () => {
    const merchant = await merchantWithStore(app)
    const member = await redeemerFor(app, 'member')
    const body = (await view('member', member.headers, await slugOf(merchant.organisationId))).json()
    expect(body).toMatchObject({ description: null, openingHours: null, cover: null, media: [] })
  })

  it('answers one identical 404 for an unknown slug, a switched-off store and an organisation with no public name', async () => {
    const off = await merchantWithStore(app, { storeActive: false })
    const unnamed = await merchantWithStore(app, { profile: false })
    const member = await redeemerFor(app, 'member')
    const answers = await Promise.all([
      view('member', member.headers, 'no-such-store'),
      view('member', member.headers, await slugOf(off.organisationId)),
      view('member', member.headers, await slugOf(unnamed.organisationId)),
    ])
    expect(answers.map((r) => r.statusCode)).toEqual([404, 404, 404])
    // Nothing tells the three apart, so the answer cannot be used to find merchants.
    const strip = (r: (typeof answers)[number]) => ({ ...r.json(), instance: undefined, requestId: undefined, detail: undefined })
    expect(strip(answers[1]!)).toEqual(strip(answers[0]!))
    expect(strip(answers[2]!)).toEqual(strip(answers[0]!))
  })

  it('brings a switched-off store back when staff switch it on', async () => {
    const merchant = await merchantWithStore(app, { storeActive: false })
    const slug = await slugOf(merchant.organisationId)
    const member = await redeemerFor(app, 'member')
    expect((await view('member', member.headers, slug)).statusCode).toBe(404)
    await app.pg.query('UPDATE stores SET active = true, deactivated_at = NULL, deactivation_reason = NULL WHERE id = $1', [merchant.storeId])
    expect((await view('member', member.headers, slug)).statusCode).toBe(200)
  })

  it('refuses a request with no credentials, and one from the wrong audience', async () => {
    const { slug } = await storeWithContent()
    expect((await app.inject({ method: 'GET', url: `/member/offers/stores/${slug}` })).statusCode).toBe(401)
    // A merchant token is not a member token: each audience has its own mount.
    const merchant = await redeemerFor(app, 'merchant')
    expect((await app.inject({ method: 'GET', url: `/member/offers/stores/${slug}`, headers: merchant.headers })).statusCode).toBe(403)
  })
})
