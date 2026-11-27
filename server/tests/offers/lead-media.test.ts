import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { merchantWithStore, seedOffer, seedReadyAsset, redeemerFor, resetOffers, CLUB_OFFERS } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 042, FR-012 / research R7: the *lead* of an offer's media is its first
 * **ready** item, defined once (`LEAD_OFFER_ASSET`). The list card, the detail's
 * first item and the redemption's thumbnail must agree, including while the first
 * stored item is still being processed.
 *
 * Before this feature the list took `position = 0` whatever the asset's state,
 * while the detail dropped assets that were not ready, so a merchant whose first
 * video was still processing saw no picture on the card and a different one
 * first on the detail page.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
})

const link = (offerId: string, assetId: string, position: number) =>
  app.pg.query('INSERT INTO offer_media (offer_id, asset_id, position) VALUES ($1, $2, $3)', [offerId, assetId, position])

async function fixture() {
  const merchant = await merchantWithStore(app)
  const offer = await seedOffer(app.pg, { organisationId: merchant.organisationId, storeId: merchant.storeId })
  const asset = (state = 'ready', kind: 'image' | 'video' = 'image') =>
    seedReadyAsset(app.pg, { uploaderId: merchant.id, uploaderKind: 'merchant', state, kind })
  const member = await redeemerFor(app, 'member')
  const listThumb = async () => {
    const res = await app.inject({ method: 'GET', url: CLUB_OFFERS.member, headers: member.headers })
    expect(res.statusCode).toBe(200)
    return res.json().items.find((i: { id: string }) => i.id === offer)?.thumbnail ?? null
  }
  const detailMedia = async () => {
    const res = await app.inject({ method: 'GET', url: `${CLUB_OFFERS.member}/${offer}`, headers: member.headers })
    expect(res.statusCode).toBe(200)
    return res.json().media as { assetId: string }[]
  }
  return { merchant, offer, asset, member, listThumb, detailMedia }
}

describe.skipIf(!hasDatabase)('the lead media of an offer', () => {
  it('is the first item, and the list and the detail agree on it', async () => {
    const f = await fixture()
    const [a, b] = [await f.asset(), await f.asset()]
    await link(f.offer, a, 0)
    await link(f.offer, b, 1)

    const thumb = await f.listThumb()
    const media = await f.detailMedia()
    expect(thumb.assetId).toBe(a)
    expect(media.map((m) => m.assetId)).toEqual([a, b])
    expect(thumb.assetId).toBe(media[0]!.assetId)
  })

  it('skips a first item that is still processing, in the list AND the detail', async () => {
    const f = await fixture()
    const processing = await f.asset('processing')
    const ready = await f.asset()
    await link(f.offer, processing, 0)
    await link(f.offer, ready, 1)

    const thumb = await f.listThumb()
    const media = await f.detailMedia()
    // Counter-assertion: the old list query took position 0 regardless of state,
    // so it answered `thumbnail: null` here while the detail led with `ready`.
    expect(thumb).not.toBeNull()
    expect(thumb.assetId).toBe(ready)
    expect(media.map((m) => m.assetId)).toEqual([ready])
    expect(thumb.assetId).toBe(media[0]!.assetId)
  })

  it('leads again with the first item once it becomes ready', async () => {
    const f = await fixture()
    const first = await f.asset('processing')
    const second = await f.asset()
    await link(f.offer, first, 0)
    await link(f.offer, second, 1)
    expect((await f.listThumb()).assetId).toBe(second)

    await app.pg.query(`UPDATE assets SET state = 'ready' WHERE id = $1`, [first])
    await app.pg.query(
      `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
       VALUES ($1, 'thumb', 'webp', 160, 90, 1000, $2)`,
      [first, `test/${randomUUID()}`],
    )

    expect((await f.listThumb()).assetId).toBe(first)
    expect((await f.detailMedia())[0]!.assetId).toBe(first)
  })

  it('is null and [] when there is no usable media at all (the client shows the fallback)', async () => {
    const f = await fixture()
    expect(await f.listThumb()).toBeNull()
    expect(await f.detailMedia()).toEqual([])

    // Only unready media is also "no usable media".
    await link(f.offer, await f.asset('processing'), 0)
    expect(await f.listThumb()).toBeNull()
    expect(await f.detailMedia()).toEqual([])
  })

  it('is the same picture in a redemption answer as on the list', async () => {
    const f = await fixture()
    const processing = await f.asset('processing')
    const ready = await f.asset()
    await link(f.offer, processing, 0)
    await link(f.offer, ready, 1)

    const res = await app.inject({
      method: 'POST', url: `${CLUB_OFFERS.member}/${f.offer}/redemptions`, headers: f.member.headers,
      payload: { requestId: randomUUID() },
    })
    expect(res.statusCode).toBe(201)
    // `thumbnailUrl` is the thumb of the lead, which is the second item.
    const thumbUrl = (await f.listThumb()).variants.find((v: { variant: string }) => v.variant === 'thumb')?.url
    expect(res.json().thumbnailUrl).toBe(thumbUrl)
    expect(res.json().thumbnailUrl).not.toBeNull()
  })
})
