import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, seedReadyAsset, resetOffers } from './helpers.ts'
import { MAX_OFFER_MEDIA } from '@gwc/contracts/offers'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-013 and FR-014: an offer holds at most ten images and videos,
 * the server enforces it (the database's position bound is the backstop), and
 * clients only ever receive derivatives.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

async function setup() {
  const merchant = await merchantWithStore(app)
  const offerId = await seedOffer(app.pg, {
    organisationId: merchant.organisationId, storeId: merchant.storeId, state: 'draft',
  })
  const assets = async (n: number) =>
    Promise.all(Array.from({ length: n }, () => seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })))
  const put = (assetIds: string[], headers = merchant.headers) =>
    app.inject({ method: 'PUT', url: `/merchant/offers/${offerId}/media`, headers, payload: { assetIds } })
  const read = async () => {
    const list = await app.inject({ method: 'GET', url: '/merchant/offers', headers: merchant.headers })
    return list.json().items.find((o: { id: string }) => o.id === offerId)
  }
  return { merchant, offerId, assets, put, read }
}

describe.skipIf(!hasDatabase)('an offer’s media set', () => {
  it('accepts ten, keeps their order and leads with the first', async () => {
    const { assets, put, read } = await setup()
    const ids = await assets(MAX_OFFER_MEDIA)
    const response = await put(ids)

    expect(response.statusCode).toBe(200)
    expect(response.json().media.map((m: { assetId: string }) => m.assetId)).toEqual(ids)
    expect((await read()).media[0].assetId).toBe(ids[0])
  })

  it('refuses an eleventh with 422 and leaves the previous set untouched', async () => {
    const { assets, put, read } = await setup()
    const first = await assets(3)
    await put(first)

    const eleven = await assets(MAX_OFFER_MEDIA + 1)
    const response = await put(eleven)

    expect(response.statusCode).toBe(422)
    expect(response.json().type).toContain('media-limit')
    expect((await read()).media.map((m: { assetId: string }) => m.assetId)).toEqual(first)
  })

  it('is bounded by the database as well: position 10 does not exist', async () => {
    const { merchant, offerId } = await setup()
    const [asset] = await Promise.all([seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant' })])
    await expect(
      app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, 10)', [offerId, asset]),
    ).rejects.toThrow(/offer_media_position_bounded/)
    // Counter-assertion: position 9 is the tenth item and is fine.
    await expect(
      app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, 9)', [offerId, asset]),
    ).resolves.toBeTruthy()
  })

  it('allows an offer with no media, and replacing a set with an empty one', async () => {
    const { assets, put, read } = await setup()
    expect((await read()).media).toEqual([])
    await put(await assets(2))
    const cleared = await put([])
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().media).toEqual([])
  })

  it('refuses another organisation’s file, an unknown file and a failed file', async () => {
    const { merchant, put, read } = await setup()
    const other = await merchantWithStore(app)
    const theirs = await seedReadyAsset(app.pg, { uploaderId: other.id, uploaderKind: 'merchant' })
    const failed = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant', state: 'failed' })

    expect((await put([theirs])).statusCode).toBe(404)
    expect((await put(['00000000-0000-4000-8000-000000000000'])).statusCode).toBe(404)
    expect((await read()).media).toEqual([])
    expect([400, 404]).toContain((await put([failed])).statusCode)
  })

  it('refuses the same file twice in one set', async () => {
    const { put, assets } = await setup()
    const [a] = await assets(1)
    expect((await put([a!, a!])).statusCode).toBe(400)
  })

  it('serves derivatives only: no storage key and no original anywhere in the body', async () => {
    const { put, assets } = await setup()
    const response = await put(await assets(2))
    expect(response.statusCode).toBe(200)
    // seedReadyAsset stores originals under `test/`; nothing of that may leak.
    expect(response.body).not.toContain('test/')
    expect(response.body).not.toMatch(/storage_?key|storageKey/)
    expect(response.json().media[0].variants.length + (response.json().media[0].posterUrl ? 1 : 0)).toBeGreaterThan(0)
  })

  it('does not count a file still processing as a shown item, but allows attaching it', async () => {
    const { merchant, put, read, offerId } = await setup()
    const processing = await seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant', state: 'processing' })
    expect((await put([processing])).statusCode).toBe(200)
    // It is linked (it holds a place) but not delivered until it is ready.
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM offer_media WHERE offer_id = $1', [offerId])
    expect(rows[0].n).toBe(1)
    expect((await read()).media).toEqual([])
  })
})
