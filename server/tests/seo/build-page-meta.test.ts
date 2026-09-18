import { describe, it, expect } from 'vitest'
import { buildPageMeta, truncate, withSiteName, absolute, shareImageFromVariants } from '../../src/modules/seo/build-page-meta.ts'
import { SITE_NAME, DESCRIPTION_MAX, pageMetaSchema } from '@gwc/contracts/seo'

/**
 * FR-018 / FR-020 / FR-025 — the rules the resolver enforces internally, so no
 * caller can omit them.
 *
 * §10.3 names the failure mode this file guards: "hand-maintained metadata that
 * duplicates on-page copy drifts and is a recurring defect source."
 */

const ORIGIN = 'https://german-world-club.test'

const record = (over = {}) => ({
  recordType: 'partner',
  recordId: '11111111-1111-1111-1111-111111111111',
  slug: 'mueller-legal',
  title: 'Müller Legal Consultants',
  description: 'German-speaking legal advice for expatriates in Dubai and Abu Dhabi.',
  language: 'de',
  indexable: true,
  published: true,
  updatedAt: '2026-03-01T10:00:00.000Z',
  sections: [],
  ...over,
})

describe('staff-override precedence (FR-020)', () => {
  it('prefers seo_title over the derived title', () => {
    const meta = buildPageMeta(record({ seoTitle: 'Rechtsberatung Dubai' }), { origin: ORIGIN })
    expect(meta.title).toBe(`Rechtsberatung Dubai — ${SITE_NAME}`)
    expect(meta.title).not.toContain('Müller Legal')
  })

  it('prefers meta_description over the derived description', () => {
    const meta = buildPageMeta(record({ metaDescription: 'Kanzlei in Dubai.' }), { origin: ORIGIN })
    expect(meta.description).toBe('Kanzlei in Dubai.')
  })

  it('falls back to derived values when no override exists — never the reverse', () => {
    const meta = buildPageMeta(record({ seoTitle: null, metaDescription: '   ' }), { origin: ORIGIN })
    expect(meta.title).toContain('Müller Legal Consultants')
    expect(meta.description).toContain('German-speaking legal advice')
  })
})

describe('HTML safety', () => {
  it('carries a quote-bearing business name through unmangled, for the serializer to escape', () => {
    const meta = buildPageMeta(record({ title: 'The "Best" Kanzlei' }), { origin: ORIGIN })
    expect(meta.title).toContain('"Best"')
  })
})

describe('share image completeness (FR-018)', () => {
  const shareImage = { url: '/media/abc/large.webp', width: 1600, height: 1200, alt: 'The office' }

  it('absolutizes the image URL against the one canonical origin', () => {
    const meta = buildPageMeta(record({ shareImage }), { origin: ORIGIN })
    expect(meta.og.image.url).toBe(`${ORIGIN}/media/abc/large.webp`)
  })

  it('carries width, height and alt — all three, never a subset', () => {
    const meta = buildPageMeta(record({ shareImage }), { origin: ORIGIN })
    expect(meta.og.image).toMatchObject({ width: 1600, height: 1200, alt: 'The office' })
  })

  it('validates against the shared schema, so an incomplete image is a test failure', () => {
    const meta = buildPageMeta(record({ shareImage }), { origin: ORIGIN })
    expect(pageMetaSchema.safeParse(meta).success).toBe(true)

    const incomplete = buildPageMeta(
      record({ shareImage: { url: '/media/abc/large.webp', width: 1600, alt: 'x' } }),
      { origin: ORIGIN },
    )
    expect(pageMetaSchema.safeParse(incomplete).success).toBe(false)
  })

  it('selects the large WebP variant — preview bots expect roughly 1200×630', () => {
    const chosen = shareImageFromVariants(
      [
        { variant: 'thumb', format: 'webp', width: 160, height: 120, checksumHex: 'ab' },
        { variant: 'large', format: 'jpeg', width: 1600, height: 1200, checksumHex: 'ab' },
        { variant: 'large', format: 'webp', width: 1600, height: 1200, checksumHex: 'ab' },
      ],
      'The office',
    )
    expect(chosen).toMatchObject({ url: '/media/ab/large.webp', width: 1600, alt: 'The office' })
  })

  it('never selects a stored original as a rendering path (FR-060)', () => {
    const chosen = shareImageFromVariants([{ variant: 'medium', format: 'webp', width: 800, height: 600, checksumHex: 'cd' }], 'x')
    expect(chosen.url).toMatch(/^\/media\/[0-9a-f]+\/(thumb|small|medium|large)\.(webp|png|jpeg)$/)
  })
})

describe('title and description shaping', () => {
  it('appends the site name exactly once', () => {
    expect(withSiteName(`Kanzlei — ${SITE_NAME}`)).toBe(`Kanzlei — ${SITE_NAME}`)
    expect(withSiteName('Kanzlei')).toBe(`Kanzlei — ${SITE_NAME}`)
    expect(withSiteName(SITE_NAME)).toBe(SITE_NAME)
  })

  it('truncates the description at a word boundary, never mid-word', () => {
    const long = 'Wort '.repeat(80).trim()
    const out = truncate(long, DESCRIPTION_MAX)
    expect(out.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
    expect(out).not.toMatch(/Wo…$/)
  })

  it('leaves a short description untouched', () => {
    expect(truncate('Kurz.', DESCRIPTION_MAX)).toBe('Kurz.')
  })
})

describe('indexability is the stricter of the two (FR-025)', () => {
  it('indexes a published, indexable record on an indexed surface', () => {
    expect(buildPageMeta(record(), { origin: ORIGIN }).robots).toBe('index,follow')
  })

  it('honours a record opting out', () => {
    expect(buildPageMeta(record({ indexable: false }), { origin: ORIGIN }).robots).toBe('noindex,nofollow')
  })

  it('refuses to index an unpublished record', () => {
    expect(buildPageMeta(record({ published: false }), { origin: ORIGIN }).robots).toBe('noindex,nofollow')
  })

  it('never lets a record opt IN to a surface §10.1 declares gated', () => {
    const meta = buildPageMeta(record({ recordType: 'page', slug: 'profile', indexable: true }), {
      origin: ORIGIN,
      surfaceAuth: { audience: 'member' },
    })
    expect(meta.robots).toBe('noindex,nofollow')
  })
})

describe('absolutisation', () => {
  it('leaves an already-absolute URL alone', () => {
    expect(absolute(ORIGIN, 'https://cdn.example/x.png')).toBe('https://cdn.example/x.png')
  })

  it('builds the canonical on the one origin', () => {
    expect(buildPageMeta(record(), { origin: ORIGIN }).canonical).toBe(`${ORIGIN}/partners/mueller-legal`)
  })

  it('refuses to run without an origin — a relative og:image breaks every preview bot', () => {
    expect(() => buildPageMeta(record(), {})).toThrow(/origin/i)
  })
})
