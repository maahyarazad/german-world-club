import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, multipartBody, resetMedia, uploader } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { merchantWithStore, resetOffers } from '../offers/helpers.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import { MERCHANT_IMAGE_MAX_BYTES } from '@gwc/contracts/media'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 035, FR-034: what a merchant uploads is held to a photo under 1 MiB
 * and a video under 5 MiB, decided by the server, after content inspection.
 * Members and partners keep the platform's 25 MB ceiling.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => {
  await resetOffers(app.pg)
  await resetAuthTables(app.pg)
  await resetMedia(app.pg)
})

/**
 * A PNG of incompressible noise at an exact pixel count, so its size is a
 * property of the dimensions, not of a codec's mood. 3 bytes per pixel, stored.
 */
async function noisePng(pixels: number) {
  const width = 1000
  const height = Math.ceil(pixels / width)
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 0 }).toBuffer()
}

const send = (headers: Record<string, string>, file: Buffer, url: string, filename = 'p.png', contentType = 'image/png') => {
  const body = multipartBody({ file, filename, contentType, fields: { alt: 'A test photo' } })
  return app.inject({ method: 'POST', url, headers: { ...headers, ...body.headers }, payload: body.payload })
}

describe.skipIf(!hasDatabase)('merchant upload limits', () => {
  it('accepts a photo just under 1 MiB and refuses one at or above it', async () => {
    const merchant = await merchantWithStore(app)
    const under = await noisePng(340_000)   // ~1.02 MB of pixels = under 1 MiB once framed
    const over = await noisePng(360_000)    // ~1.08 MB, over
    expect(under.length).toBeLessThan(MERCHANT_IMAGE_MAX_BYTES)
    expect(over.length).toBeGreaterThanOrEqual(MERCHANT_IMAGE_MAX_BYTES)

    const ok = await send(merchant.headers, under, '/media/merchant')
    expect(ok.statusCode).toBe(201)

    const refused = await send(merchant.headers, over, '/media/merchant')
    expect(refused.statusCode).toBe(413)
    expect(refused.json().type).toContain('media-too-large')
  })

  it('stores nothing and charges no quota for a refused upload', async () => {
    const merchant = await merchantWithStore(app)
    await send(merchant.headers, await noisePng(500_000), '/media/merchant')
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n).toBe(0)
    const { rows: counters } = await app.pg.query(`SELECT count(*)::int AS n FROM counters WHERE scope = 'media.stored_bytes'`)
    expect(counters[0].n).toBe(0)
  })

  it('cuts a very large file off without needing it to finish: 6 MB is refused', async () => {
    const merchant = await merchantWithStore(app)
    const huge = Buffer.concat([await noisePng(100_000), randomBytes(6 * 1024 * 1024)])
    const response = await send(merchant.headers, huge, '/media/merchant')
    expect(response.statusCode).toBe(413)
  })

  it('decides by content, not by the declared type: a big image called a video is still an image', async () => {
    const merchant = await merchantWithStore(app)
    const over = await noisePng(360_000)
    const response = await send(merchant.headers, over, '/media/merchant', 'clip.mp4', 'video/mp4')
    expect(response.statusCode).toBe(413)
  })

  it('does not hold members or partners to the merchant limit — the counter-assertion', async () => {
    const big = await noisePng(360_000)     // over 1 MiB, well under 25 MB
    const { headers } = await uploader(app)
    expect((await send(headers, big, '/media')).statusCode).toBe(201)

    const partner = await organisationUser(app, 'partner')
    expect((await send(partner.headers as unknown as Record<string, string>, big, '/media/partner')).statusCode).toBe(201)
  })
})
