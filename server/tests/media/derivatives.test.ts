import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph, smallImage } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { deriveImage, breakpointsFor, BREAKPOINTS } from '../../src/modules/media/derive-image.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-056, FR-061 — every breakpoint, with its own recorded dimensions and
 * bytes, and never an upscale.
 *
 * The recorded dimensions are not bookkeeping: §10.9 names unsized images as
 * the most common cause of layout shift, and a `<picture>` can only carry
 * explicit `width`/`height` if something wrote them down at ingest.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const PIXELS = { limitInputPixels: 50_000_000 }

describe('which breakpoints a source produces (FR-056)', () => {
  it('produces every breakpoint for a source wider than all of them', () => {
    expect(breakpointsFor(2400).map((b) => b.variant)).toEqual(['thumb', 'small', 'medium', 'large'])
  })

  /**
   * The rule stated in media-pipeline.md §5: a 300 px source yields `thumb` and
   * `small` — `small` clamped to 300 rather than upscaled to 400, and `medium`
   * and `large` not produced at all.
   */
  it('yields thumb and a clamped small for a 300 px source, and nothing larger', () => {
    const produced = breakpointsFor(300)
    expect(produced.map((b) => b.variant)).toEqual(['thumb', 'small'])
    expect(produced.find((b) => b.variant === 'small').width).toBe(300)
    expect(produced.some((b) => b.variant === 'medium' || b.variant === 'large')).toBe(false)
  })

  it('never asks for a width above the source', () => {
    for (const sourceWidth of [50, 160, 300, 400, 799, 800, 1599, 1600, 4000]) {
      for (const produced of breakpointsFor(sourceWidth)) {
        expect(produced.width, `source ${sourceWidth} asked for ${produced.width}`).toBeLessThanOrEqual(sourceWidth)
      }
    }
  })

  it('emits no duplicate variant when the source lands exactly on a breakpoint', () => {
    for (const { width } of BREAKPOINTS) {
      const variants = breakpointsFor(width).map((b) => b.variant)
      expect(new Set(variants).size, `source exactly ${width} px`).toBe(variants.length)
    }
  })

  it('still produces something for a source narrower than every breakpoint', () => {
    // Otherwise a 100 px avatar has no derivative at all and the page is pushed
    // back to the original, which FR-060 forbids delivering.
    expect(breakpointsFor(100)).toEqual([{ variant: 'thumb', width: 100 }])
  })
})

describe('what each derivative records (FR-061)', () => {
  it('records real dimensions and a real byte count for every variant', async () => {
    const { variants } = await deriveImage(await photograph({ width: 2400, height: 1600 }), PIXELS)

    expect(variants.length).toBeGreaterThan(0)
    for (const variant of variants) {
      expect(variant.width).toBeGreaterThan(0)
      expect(variant.height).toBeGreaterThan(0)
      expect(variant.bytes).toBeGreaterThan(0)
      // The recorded byte count must be the actual encoded length, not an
      // estimate — a `<picture>` and a quota both depend on it.
      expect(variant.bytes).toBe(variant.buffer.length)
    }
  })

  it('preserves the aspect ratio at every size', async () => {
    const { source, variants } = await deriveImage(await photograph({ width: 2400, height: 1600 }), PIXELS)
    const sourceRatio = source.width / source.height

    for (const variant of variants) {
      // One pixel of tolerance: an odd target height has to round somewhere.
      expect(variant.width / variant.height).toBeCloseTo(sourceRatio, 1)
    }
  })

  it('never upscales, whatever is asked for', async () => {
    const { source, variants } = await deriveImage(await smallImage({ width: 300, height: 200 }), PIXELS)

    for (const variant of variants) {
      expect(variant.width, `${variant.variant} is wider than the source`).toBeLessThanOrEqual(source.width)
      expect(variant.height).toBeLessThanOrEqual(source.height)
    }
  })

  it('makes each size smaller than the one above it', async () => {
    const { variants } = await deriveImage(await photograph({ width: 2400, height: 1600 }), PIXELS)
    const webp = variants.filter((v) => v.format === 'webp').sort((a, b) => a.width - b.width)

    for (let i = 1; i < webp.length; i += 1) {
      expect(webp[i].width).toBeGreaterThan(webp[i - 1].width)
      expect(webp[i].bytes).toBeGreaterThan(webp[i - 1].bytes)
    }
  })
})

describe.skipIf(!hasDatabase)('as recorded and delivered', () => {
  let headers: Record<string, string>

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('returns every variant URL in the upload response itself', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    expect(response.statusCode).toBe(201)
    const body = response.json()
    expect(body.state).toBe('ready')
    expect(new Set(body.variants.map((v) => v.variant))).toEqual(new Set(['thumb', 'small', 'medium', 'large']))

    // Every URL must actually resolve — a recorded variant with no bytes behind
    // it is the failure mode the whole fail-closed rule exists to prevent.
    for (const variant of body.variants) {
      const fetched = await app.inject({ method: 'GET', url: variant.url })
      expect(fetched.statusCode, variant.url).toBe(200)
      expect(fetched.rawPayload.length).toBe(variant.bytes)
    }
  })

  it('persists the dimensions a <picture> needs', async () => {
    await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    const { rows } = await app.pg.query('SELECT variant, format, width, height, bytes FROM asset_variants')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.width).toBeGreaterThan(0)
      expect(row.height).toBeGreaterThan(0)
      expect(Number(row.bytes)).toBeGreaterThan(0)
    }
  })

  it('records the source dimensions on the asset (FR-055)', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })
    expect(response.json()).toMatchObject({ width: 2400, height: 1600 })
  })

  it('produces no upscaled variant from a 300 px source', async () => {
    const response = await upload(app, headers, {
      file: await smallImage({ width: 300, height: 200 }), filename: 'small.jpg', alt: 'Small',
    })

    const body = response.json()
    expect(new Set(body.variants.map((v) => v.variant))).toEqual(new Set(['thumb', 'small']))
    for (const variant of body.variants) {
      expect(variant.width).toBeLessThanOrEqual(300)
    }
  })
})
