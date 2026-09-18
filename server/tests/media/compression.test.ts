import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { deriveImage } from '../../src/modules/media/derive-image.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-019 — a 2 MB photograph yields `medium` ≤ 60 KB and `thumb` ≤ 8 KB.
 *
 * This is the criterion that makes the whole pipeline worth having. Partner
 * logos, article headers and event galleries are the dominant weight on exactly
 * the pages whose visibility the club sells, and a phone on a hotel connection
 * in Dubai is the reader those pages are competing for.
 *
 * The fixture is structured noise, which is *harder* to compress than a real
 * photograph — smooth gradients and flat regions are what encoders are good at.
 * So these ceilings are conservative: anything that passes here passes on real
 * content with room to spare.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const PIXELS = { limitInputPixels: 50_000_000 }
const KB = 1024

describe('SC-019 ceilings', () => {
  let source
  let variants: Record<string, unknown>

  beforeAll(async () => {
    source = await photograph({ width: 2400, height: 1600 })
    variants = (await deriveImage(source, PIXELS)).variants
  })

  const webp = (variant) => variants.find((v) => v.variant === variant && v.format === 'webp')

  it('starts from a source of roughly 2 MB, or the ceilings mean nothing', () => {
    expect(source.length).toBeGreaterThan(1_000_000)
  })

  it('keeps `medium` under 60 KB', () => {
    const medium = webp('medium')
    expect(medium, 'medium must exist to be measured').toBeDefined()
    expect(medium.bytes, `medium is ${(medium.bytes / KB).toFixed(1)} KB`).toBeLessThanOrEqual(60 * KB)
  })

  it('keeps `thumb` under 8 KB', () => {
    const thumb = webp('thumb')
    expect(thumb.bytes, `thumb is ${(thumb.bytes / KB).toFixed(1)} KB`).toBeLessThanOrEqual(8 * KB)
  })

  it('keeps the JPEG fallbacks within the same ceilings', () => {
    // A fallback nobody budgeted for is how a pipeline that looks compliant
    // still ships a megabyte to an older browser.
    const jpeg = (variant) => variants.find((v) => v.variant === variant && v.format === 'jpeg')
    expect(jpeg('medium').bytes).toBeLessThanOrEqual(60 * KB)
    expect(jpeg('thumb').bytes).toBeLessThanOrEqual(8 * KB)
  })

  it('delivers a small fraction of the original at phone width', () => {
    // The point of the exercise, stated directly: `small` is what a phone
    // layout actually receives.
    const small = webp('small')
    expect(small.bytes / source.length).toBeLessThan(0.1)
  })
})

describe.skipIf(!hasDatabase)('end to end', () => {
  let headers: Record<string, string>

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('records byte counts matching what is actually delivered', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    for (const variant of response.json().variants) {
      const fetched = await app.inject({ method: 'GET', url: variant.url })
      expect(fetched.rawPayload.length, `${variant.variant}.${variant.format}`).toBe(variant.bytes)
    }
  })

  it('meets the SC-019 ceilings through the endpoint, not only in the unit', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    const body = response.json()
    const medium = body.variants.find((v) => v.variant === 'medium' && v.format === 'webp')
    const thumb = body.variants.find((v) => v.variant === 'thumb' && v.format === 'webp')

    expect(medium.bytes).toBeLessThanOrEqual(60 * KB)
    expect(thumb.bytes).toBeLessThanOrEqual(8 * KB)
  })
})
