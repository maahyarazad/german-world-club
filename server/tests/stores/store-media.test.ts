import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedReadyAsset, resetOffers } from '../offers/helpers.ts'
import { MAX_STORE_MEDIA, isWideCover } from '@gwc/contracts/media'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-032 and FR-033: the store's wide cover (about 16:9, an image)
 * and its gallery of at most ten photos or videos. The cover is not one of the
 * ten, a refusal leaves what was there, and the database bounds the gallery too.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const asset = (merchant: { id: string }, options: Parameters<typeof seedReadyAsset>[1] extends infer T ? Partial<T> : never = {}) =>
  seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant', ...options })

describe('the wide-cover rule itself', () => {
  it.each([
    [1600, 900, true], [1280, 720, true], [1920, 1080, true], [1610, 900, true],
    [800, 800, false], [900, 1600, false], [1200, 900, false], [1600, 700, false], [0, 0, false],
  ])('%i x %i is wide: %s', (w, h, expected) => {
    expect(isWideCover(w, h)).toBe(expected)
  })
})

describe.skipIf(!hasDatabase)('the store cover', () => {
  const put = (merchant: { headers: Record<string, string> }, assetId: string | null) =>
    app.inject({ method: 'PUT', url: '/merchant/store/cover', headers: merchant.headers, payload: { assetId } })

  it('accepts a wide image and shows it as a derivative', async () => {
    const merchant = await merchantWithStore(app)
    const id = await asset(merchant, { width: 1600, height: 900 })
    const response = await put(merchant, id)
    expect(response.statusCode).toBe(200)
    expect(response.json().cover.assetId).toBe(id)
    expect(response.body).not.toContain('test/')
  })

  it.each([[800, 800], [900, 1600], [1200, 900]])('refuses a %i x %i image and keeps the previous cover', async (w, h) => {
    const merchant = await merchantWithStore(app)
    const good = await asset(merchant, { width: 1600, height: 900 })
    await put(merchant, good)

    const response = await put(merchant, await asset(merchant, { width: w, height: h }))
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toContain('cover-aspect-ratio')
    const after = (await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json()
    expect(after.cover.assetId).toBe(good)
  })

  it('refuses a video as a cover', async () => {
    const merchant = await merchantWithStore(app)
    const video = await asset(merchant, { kind: 'video', width: 1920, height: 1080 })
    expect((await put(merchant, video)).statusCode).toBe(422)
  })

  it('refuses another organisation’s image, and clears the cover with null', async () => {
    const merchant = await merchantWithStore(app)
    const other = await merchantWithStore(app)
    expect((await put(merchant, await asset(other))).statusCode).toBe(404)

    await put(merchant, await asset(merchant))
    const cleared = await put(merchant, null)
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().cover).toBeNull()
  })
})

describe.skipIf(!hasDatabase)('the store gallery', () => {
  const put = (merchant: { headers: Record<string, string> }, assetIds: string[]) =>
    app.inject({ method: 'PUT', url: '/merchant/store/media', headers: merchant.headers, payload: { assetIds } })

  it('accepts ten in order', async () => {
    const merchant = await merchantWithStore(app)
    const ids = await Promise.all(Array.from({ length: MAX_STORE_MEDIA }, () => asset(merchant)))
    const response = await put(merchant, ids)
    expect(response.statusCode).toBe(200)
    expect(response.json().media.map((m: { assetId: string }) => m.assetId)).toEqual(ids)
  })

  it('refuses an eleventh with 422 and leaves the gallery as it was', async () => {
    const merchant = await merchantWithStore(app)
    const three = await Promise.all(Array.from({ length: 3 }, () => asset(merchant)))
    await put(merchant, three)

    const eleven = await Promise.all(Array.from({ length: MAX_STORE_MEDIA + 1 }, () => asset(merchant)))
    const response = await put(merchant, eleven)
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toContain('media-limit')
    const after = (await app.inject({ method: 'GET', url: '/merchant/store', headers: merchant.headers })).json()
    expect(after.media.map((m: { assetId: string }) => m.assetId)).toEqual(three)
  })

  it('is bounded by the database: position 10 does not exist, position 9 does', async () => {
    const merchant = await merchantWithStore(app)
    const id = await asset(merchant)
    await expect(
      app.pg.query('INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, 10)', [merchant.storeId, id]),
    ).rejects.toThrow(/store_media_position_bounded/)
    await expect(
      app.pg.query('INSERT INTO store_media (store_id, asset_id, position) VALUES ($1, $2, 9)', [merchant.storeId, id]),
    ).resolves.toBeTruthy()
  })

  it('does not count the cover as one of the ten — the counter-assertion', async () => {
    const merchant = await merchantWithStore(app)
    const cover = await asset(merchant, { width: 1600, height: 900 })
    await app.inject({ method: 'PUT', url: '/merchant/store/cover', headers: merchant.headers, payload: { assetId: cover } })
    const ids = await Promise.all(Array.from({ length: MAX_STORE_MEDIA }, () => asset(merchant)))
    const response = await put(merchant, ids)
    expect(response.statusCode).toBe(200)
    expect(response.json().cover.assetId).toBe(cover)
    expect(response.json().media).toHaveLength(MAX_STORE_MEDIA)
  })

  it('refuses another organisation’s files and a failed file', async () => {
    const merchant = await merchantWithStore(app)
    const other = await merchantWithStore(app)
    expect((await put(merchant, [await asset(other)])).statusCode).toBe(404)
    expect([400, 404]).toContain((await put(merchant, [await asset(merchant, { state: 'failed' })])).statusCode)
  })
})
