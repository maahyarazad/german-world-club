import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, multipartBody, resetMedia, uploader } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { merchantWithStore, seedOffer, redeemerFor, resetOffers } from '../offers/helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-035 and research R16: a merchant can delete a file they
 * uploaded when nothing uses it, which releases its storage; a file a store,
 * offer or logo still uses is refused with 409 `media-in-use`.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
  await resetMedia(app.pg)
})

async function upload(headers: Record<string, string>, url = '/media/merchant') {
  const file = await sharp(randomBytes(300 * 300 * 3), { raw: { width: 300, height: 300, channels: 3 } }).png().toBuffer()
  const body = multipartBody({ file, filename: 'p.png', contentType: 'image/png', fields: { alt: 'A test photo' } })
  const response = await app.inject({ method: 'POST', url, headers: { ...headers, ...body.headers }, payload: body.payload })
  return response.json() as { id: string; bytes: number }
}

const used = async () => {
  const { rows } = await app.pg.query(`SELECT coalesce(sum(used), 0)::bigint AS n FROM counters WHERE scope = 'media.stored_bytes'`)
  return Number(rows[0].n)
}

describe.skipIf(!hasDatabase)('a merchant deleting their own files', () => {
  it('deletes an unused file and gives its storage back', async () => {
    const merchant = await merchantWithStore(app)
    const asset = await upload(merchant.headers)
    expect(await used()).toBeGreaterThan(0)

    const response = await app.inject({ method: 'DELETE', url: `/media/merchant/${asset.id}`, headers: merchant.headers })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: asset.id, deleted: true })
    expect(await used()).toBe(0)
  })

  it.each([
    ['an offer', async (m: Awaited<ReturnType<typeof merchantWithStore>>, id: string) => {
      const offer = await seedOffer(app.pg, { organisationId: m.organisationId, storeId: m.storeId, state: 'draft' })
      await app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, 0)', [offer, id])
    }],
    ['the store gallery', async (m: Awaited<ReturnType<typeof merchantWithStore>>, id: string) => {
      await app.pg.query('INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, 0)', [m.storeId, id])
    }],
    ['the store cover', async (m: Awaited<ReturnType<typeof merchantWithStore>>, id: string) => {
      await app.pg.query('UPDATE stores SET cover_asset_id = $2 WHERE id = $1', [m.storeId, id])
    }],
    ['the logo', async (m: Awaited<ReturnType<typeof merchantWithStore>>, id: string) => {
      await app.pg.query('UPDATE organisation_profiles SET logo_asset_id = $2 WHERE organisation_id = $1', [m.organisationId, id])
    }],
  ])('refuses a file still used by %s with 409 media-in-use, and keeps it', async (_label, attach) => {
    const merchant = await merchantWithStore(app)
    const asset = await upload(merchant.headers)
    await attach(merchant, asset.id)
    const before = await used()

    const response = await app.inject({ method: 'DELETE', url: `/media/merchant/${asset.id}`, headers: merchant.headers })
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toContain('media-in-use')

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets WHERE id = $1', [asset.id])
    expect(rows[0].n).toBe(1)
    expect(await used()).toBe(before)
  })

  it('answers another organisation’s file and an unknown id the same way, and refuses a member', async () => {
    const mine = await merchantWithStore(app)
    const theirs = await merchantWithStore(app)
    const asset = await upload(theirs.headers)

    const foreign = await app.inject({ method: 'DELETE', url: `/media/merchant/${asset.id}`, headers: mine.headers })
    const absent = await app.inject({ method: 'DELETE', url: '/media/merchant/00000000-0000-4000-8000-000000000000', headers: mine.headers })
    expect(foreign.statusCode).toBe(absent.statusCode)
    expect([403, 404]).toContain(foreign.statusCode)

    const { headers } = await uploader(app)
    expect([401, 403]).toContain((await app.inject({ method: 'DELETE', url: `/media/merchant/${asset.id}`, headers })).statusCode)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets WHERE id = $1', [asset.id])
    expect(rows[0].n).toBe(1)
  })
})

describe.skipIf(!hasDatabase)('the processing state of an organisation’s own uploads', () => {
  it('shows a merchant the state of their own file and hides everyone else’s behind an identical 404', async () => {
    const mine = await merchantWithStore(app)
    const theirs = await merchantWithStore(app)
    const asset = await upload(mine.headers)

    const own = await app.inject({ method: 'GET', url: `/media/merchant/${asset.id}`, headers: mine.headers })
    expect(own.statusCode).toBe(200)
    expect(own.json()).toMatchObject({ id: asset.id, state: 'ready' })
    expect(own.body).not.toMatch(/storage_?key/)

    const foreign = await app.inject({ method: 'GET', url: `/media/merchant/${asset.id}`, headers: theirs.headers })
    const absent = await app.inject({ method: 'GET', url: '/media/merchant/00000000-0000-4000-8000-000000000000', headers: theirs.headers })
    expect(foreign.statusCode).toBe(404)
    expect(absent.statusCode).toBe(404)
  })

  it('does the same for a partner, on the partner route, and keeps the audiences apart', async () => {
    const partner = await redeemerFor(app, 'partner')
    const sibling = await redeemerFor(app, 'partner')
    const merchant = await merchantWithStore(app)
    const member = await redeemerFor(app, 'member')
    const asset = await upload(partner.headers, '/media/partner')

    const own = await app.inject({ method: 'GET', url: `/media/partner/${asset.id}`, headers: partner.headers })
    expect(own.statusCode).toBe(200)
    expect(own.json()).toMatchObject({ id: asset.id, state: 'ready' })

    // Another organisation's partner, a merchant and a member are each refused or told nothing.
    expect((await app.inject({ method: 'GET', url: `/media/partner/${asset.id}`, headers: sibling.headers })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: `/media/partner/${asset.id}`, headers: merchant.headers })).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'GET', url: `/media/partner/${asset.id}`, headers: member.headers })).statusCode).toBeGreaterThanOrEqual(401)
    // A partner has no delete route: the merchant one is not theirs.
    expect((await app.inject({ method: 'DELETE', url: `/media/merchant/${asset.id}`, headers: partner.headers })).statusCode).toBeGreaterThanOrEqual(401)
  })
})
