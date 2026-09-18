import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph, transparentLogo, opaquePng } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { deriveImage, fallbackFormatFor } from '../../src/modules/media/derive-image.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-057 — WebP primary, and the fallback chosen by whether the source has
 * alpha.
 *
 * The fallback rule is the part worth testing carefully, because getting it
 * wrong is invisible in a screenshot and expensive on the wire. PNG preserves
 * transparency, which a partner logo needs; PNG for *photographic* content runs
 * 5–10× larger than JPEG at the same perceived quality. Defaulting to PNG
 * "because it is lossless" would mean the club ships megabytes to phones in the
 * name of a fallback that almost nothing uses any more.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const PIXELS = { limitInputPixels: 50_000_000 }

describe('the fallback rule (FR-057)', () => {
  it('is PNG when the source has alpha, JPEG when it does not', () => {
    expect(fallbackFormatFor(true)).toBe('png')
    expect(fallbackFormatFor(false)).toBe('jpeg')
  })
})

describe('what a photographic source produces', () => {
  let derived
  beforeAll(async () => {
    derived = await deriveImage(await photograph({ width: 1200, height: 800 }), PIXELS)
  })

  it('offers WebP at every breakpoint', () => {
    const webp = derived.variants.filter((v) => v.format === 'webp')
    const breakpoints = new Set(derived.variants.map((v) => v.variant))
    expect(new Set(webp.map((v) => v.variant))).toEqual(breakpoints)
  })

  it('falls back to JPEG, never PNG', () => {
    const formats = new Set(derived.variants.map((v) => v.format))
    expect(formats).toEqual(new Set(['webp', 'jpeg']))
    expect(formats.has('png')).toBe(false)
  })

  /**
   * Pairs every breakpoint, which is what makes a `<picture>` able to offer a
   * real choice rather than a WebP-or-original one.
   *
   * Deliberately *not* asserting that WebP is the smaller of the two. FR-057
   * makes WebP the primary delivery format; which encoder wins on a given image
   * depends on its content, and a synthetic fixture's high-frequency noise is
   * close to the worst case for WebP while being nothing like a photograph. An
   * assertion on relative size here would be measuring the fixture.
   */
  it('pairs every breakpoint with both a primary and a fallback encoding', () => {
    for (const variant of new Set(derived.variants.map((v) => v.variant))) {
      const atSize = derived.variants.filter((v) => v.variant === variant)
      expect(atSize.map((v) => v.format).sort(), variant).toEqual(['jpeg', 'webp'])
      // Same pixel dimensions in both, or the browser's choice would change the
      // layout it already reserved.
      expect(new Set(atSize.map((v) => `${v.width}x${v.height}`)).size).toBe(1)
    }
  })
})

describe('what a transparent source produces', () => {
  let derived
  beforeAll(async () => {
    derived = await deriveImage(await transparentLogo({ width: 800, height: 400 }), PIXELS)
  })

  it('detects the alpha channel', () => {
    expect(derived.source.hasAlpha).toBe(true)
  })

  it('falls back to PNG, so transparency survives', () => {
    const formats = new Set(derived.variants.map((v) => v.format))
    expect(formats).toEqual(new Set(['webp', 'png']))
    expect(formats.has('jpeg'), 'JPEG cannot carry alpha and would flatten the logo').toBe(false)
  })
})

describe('an OPAQUE png still falls back to JPEG', () => {
  /**
   * The case that separates a correct implementation from one that switched on
   * the input *format* instead of on the alpha channel. A PNG with no
   * transparency is photographic content in a lossless container; keeping it as
   * PNG carries all of the cost and none of the benefit.
   */
  it('chooses the fallback by alpha, not by the source container', async () => {
    const derived = await deriveImage(await opaquePng({ width: 800, height: 400 }), PIXELS)
    expect(derived.source.hasAlpha).toBe(false)
    expect(new Set(derived.variants.map((v) => v.format))).toEqual(new Set(['webp', 'jpeg']))
  })
})

describe.skipIf(!hasDatabase)('as served', () => {
  let headers: Record<string, string>

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('serves each format with its own correct Content-Type', async () => {
    const response = await upload(app, headers, {
      file: await transparentLogo({ width: 800, height: 400 }), filename: 'logo.png', alt: 'Partner logo',
    })

    const expected = { webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg' }
    for (const variant of response.json().variants) {
      const fetched = await app.inject({ method: 'GET', url: variant.url })
      expect(fetched.headers['content-type']).toBe(expected[variant.format])
    }
  })

  it('names the WebP variant .webp and the PNG fallback .png in its URL', async () => {
    const response = await upload(app, headers, {
      file: await transparentLogo({ width: 800, height: 400 }), filename: 'logo.png', alt: 'Partner logo',
    })

    for (const variant of response.json().variants) {
      const extension = { webp: 'webp', png: 'png', jpeg: 'jpg' }[variant.format]
      expect(variant.url).toMatch(new RegExp(`/${variant.variant}\\.${extension}$`))
    }
  })
})
