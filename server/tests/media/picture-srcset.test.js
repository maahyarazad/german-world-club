import { describe, it, expect } from 'vitest'
import { renderShareImage } from '../../src/public/templates/partner.js'
import { sourcesFromVariants, shareImageFromVariants } from '../../src/seo/build-page-meta.js'

/**
 * FR-060, SC-018, §10.9 — the browser picks the smallest sufficient variant,
 * and the box is reserved before any bytes arrive.
 *
 * Deriving four sizes is pointless if the page only ever links one of them. The
 * `<picture>` is where the pipeline's work actually reaches a reader, which
 * makes it worth asserting directly rather than inferring from the fact that
 * derivatives exist.
 */

const VARIANTS = [
  { variant: 'thumb', format: 'webp', width: 160, height: 107, checksumHex: 'abc123' },
  { variant: 'thumb', format: 'jpeg', width: 160, height: 107, checksumHex: 'abc123' },
  { variant: 'small', format: 'webp', width: 400, height: 267, checksumHex: 'abc123' },
  { variant: 'small', format: 'jpeg', width: 400, height: 267, checksumHex: 'abc123' },
  { variant: 'medium', format: 'webp', width: 800, height: 533, checksumHex: 'abc123' },
  { variant: 'medium', format: 'jpeg', width: 800, height: 533, checksumHex: 'abc123' },
  { variant: 'large', format: 'webp', width: 1600, height: 1067, checksumHex: 'abc123' },
  { variant: 'large', format: 'jpeg', width: 1600, height: 1067, checksumHex: 'abc123' },
]

describe('grouping variants into sources', () => {
  it('produces one source per format', () => {
    const sources = sourcesFromVariants(VARIANTS)
    expect(sources.map((s) => s.format)).toEqual(['webp', 'jpeg'])
  })

  it('puts WebP first, since the browser takes the first type it supports', () => {
    // The ordering IS the format preference — there is no other mechanism
    // expressing it, so a reordering here silently demotes WebP.
    expect(sourcesFromVariants(VARIANTS)[0].format).toBe('webp')
  })

  it('lists every breakpoint with its width descriptor, ascending', () => {
    const webp = sourcesFromVariants(VARIANTS)[0]
    expect(webp.srcset).toBe(
      '/media/abc123/thumb.webp 160w, /media/abc123/small.webp 400w, ' +
        '/media/abc123/medium.webp 800w, /media/abc123/large.webp 1600w',
    )
  })

  it('names the JPEG fallback .jpg, matching how it is actually served', () => {
    const jpeg = sourcesFromVariants(VARIANTS)[1]
    expect(jpeg.srcset).toContain('/media/abc123/large.jpg 1600w')
    expect(jpeg.type).toBe('image/jpeg')
  })

  /**
   * A poster is not an alternative size of the same still, and a video is not
   * an image at all. Offering either in a srcset hands the browser a choice it
   * cannot render.
   */
  it('excludes poster and video variants', () => {
    const sources = sourcesFromVariants([
      ...VARIANTS,
      { variant: 'poster', format: 'webp', width: 1600, height: 900, checksumHex: 'abc123' },
      { variant: 'video', format: 'webm', width: 1280, height: 720, checksumHex: 'abc123' },
    ])
    expect(sources.map((s) => s.format)).toEqual(['webp', 'jpeg'])
    expect(JSON.stringify(sources)).not.toContain('poster')
    expect(JSON.stringify(sources)).not.toContain('webm')
  })

  it('returns nothing for an asset with no variants', () => {
    expect(sourcesFromVariants([])).toEqual([])
  })
})

describe('rendering the picture', () => {
  const image = shareImageFromVariants(VARIANTS, 'Die Kanzlei in Dubai')

  it('emits a <picture> with a source per format', () => {
    const html = renderShareImage(image)
    expect(html).toContain('<picture>')
    expect(html).toContain('type="image/webp"')
    expect(html).toContain('type="image/jpeg"')
  })

  /**
   * The `<img>` is what renders. A `<picture>` containing only `<source>`
   * elements displays nothing at all, and it is the `<img>` that carries the
   * dimensions and the alt text.
   */
  it('always contains an <img>, carrying the dimensions and the alt text', () => {
    const html = renderShareImage(image)
    expect(html).toContain('<img ')
    expect(html).toContain('width="1600"')
    expect(html).toContain('height="1067"')
    expect(html).toContain('alt="Die Kanzlei in Dubai"')
  })

  it('declares sizes, or the browser assumes 100vw and over-fetches on desktop', () => {
    expect(renderShareImage(image)).toContain('sizes=')
  })

  it('never references a stored original (FR-060)', () => {
    expect(renderShareImage(image)).not.toContain('original')
  })

  it('escapes the alt text, which is staff-supplied', () => {
    const hostile = { ...image, alt: '"><script>alert(1)</script>' }
    const html = renderShareImage(hostile)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('still renders a bare <img> for an image with no recorded variants', () => {
    // A fixture, or an image predating the pipeline: it must still appear,
    // just without the size choice.
    const html = renderShareImage({ url: '/media/aa11/large.webp', width: 1600, height: 1200, alt: 'Ein Bild' })
    expect(html).toContain('<img ')
    expect(html).not.toContain('<picture>')
    expect(html).toContain('width="1600"')
  })

  it('renders nothing at all when there is no image', () => {
    expect(renderShareImage(null)).toBe('')
  })
})
