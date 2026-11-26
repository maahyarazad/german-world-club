import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, resetMedia, upload, photograph } from '../helpers/media.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { ownVersion, poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Photos on a listing you are editing (feature 037, FR-001, research R5).
 *
 * A photo is part of what the member said, so a closed listing is as closed to
 * a new photo as to a new title. And attaching or removing one is its own
 * atomic operation on a different table: it must not move the listing's
 * version, or the edit form would go stale after every photo.
 */

let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('media on a listing being edited', () => {
  let owner: Awaited<ReturnType<typeof poster>>

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetMedia(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
  })

  const uploadPhoto = async () => {
    const response = await upload(app, owner.headers, { file: await photograph({ width: 600, height: 400 }), filename: 'p.jpg', alt: 'A photo' })
    expect(response.statusCode).toBe(201)
    return String(response.json().id)
  }
  const attach = (listing: string, assetId: string) =>
    app.inject({ method: 'POST', url: `/marketplace/listings/${listing}/media`, headers: owner.headers, payload: { assetId } })
  const detach = (listing: string, assetId: string) =>
    app.inject({ method: 'DELETE', url: `/marketplace/listings/${listing}/media/${assetId}`, headers: owner.headers })

  it.each(['draft', 'active', 'expired'])('allows a photo on a %s listing, without moving its version', async (state) => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state })
    const before = await ownVersion(app, owner.headers, id)
    const asset = await uploadPhoto()
    expect([200, 201]).toContain((await attach(id, asset)).statusCode)
    expect(await ownVersion(app, owner.headers, id)).toBe(before)
    expect((await detach(id, asset)).statusCode).toBe(200)
    expect(await ownVersion(app, owner.headers, id)).toBe(before)
  })

  it.each(['sold', 'filled', 'withdrawn', 'hidden'])('refuses attaching to a %s listing with 409 and links nothing', async (state) => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state })
    const response = await attach(id, await uploadPhoto())
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toMatch(/marketplace\/not-editable$/)
    const { rows } = await app.pg.query('SELECT 1 FROM marketplace_listing_media WHERE listing_id = $1', [id])
    expect(rows).toHaveLength(0)
  })

  it('refuses removing a photo from a closed listing and keeps the link', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    const asset = await uploadPhoto()
    expect([200, 201]).toContain((await attach(id, asset)).statusCode)
    await app.pg.query(`UPDATE marketplace_listings SET state = 'sold' WHERE id = $1`, [id])

    const response = await detach(id, asset)
    expect(response.statusCode).toBe(409)
    const { rows } = await app.pg.query('SELECT 1 FROM marketplace_listing_media WHERE listing_id = $1', [id])
    expect(rows).toHaveLength(1)
  })

  it("answers a stranger's attach with 404, never revealing the state", async () => {
    const stranger = await poster(app)
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'sold' })
    const asset = await uploadPhoto()
    const response = await app.inject({
      method: 'POST', url: `/marketplace/listings/${id}/media`, headers: stranger.headers, payload: { assetId: asset },
    })
    expect(response.statusCode).toBe(404)
  })
})
