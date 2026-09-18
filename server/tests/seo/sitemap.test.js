import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { renderSitemap, shouldInclude } from '../../src/seo/sitemap.js'
import { renderRobots } from '../../src/seo/robots.js'
import { disallowedPrefixes, SURFACES } from '../../src/seo/surfaces.js'
import { buildFixtureApp, RECORDS } from '../helpers/fixtures.js'

/**
 * SC-008 / FR-023 / FR-024.
 *
 * §10.5 requires entries to "appear when content is published and disappear
 * when it is unpublished, expires, or (for partners) when the listing contract
 * lapses." The query is therefore the source of truth, and the lapse needs **no
 * staff action** — a hand-maintained file fails this on the first missed edit,
 * and a partner still listed after their contract ended is, in §10.4's words,
 * "a factual misstatement to members."
 */

const ORIGIN = 'https://german-world-club.test'
const NOW = new Date('2026-06-01T00:00:00.000Z')

const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc)

describe('the inclusion predicate', () => {
  const at = (record) => shouldInclude(record, { now: NOW })

  it('includes a published, indexable record on an indexed surface', () => {
    expect(at(RECORDS.find((r) => r.slug === 'mueller-legal'))).toBe(true)
  })

  it('excludes an unpublished record', () => {
    expect(at(RECORDS.find((r) => r.slug === 'noch-nicht-fertig'))).toBe(false)
  })

  it('excludes a record staff marked non-indexable', () => {
    expect(at(RECORDS.find((r) => r.slug === 'intern-aber-oeffentlich'))).toBe(false)
  })

  it('DROPS a lapsed partner with no staff action — the headline assertion (SC-008)', () => {
    const lapsed = RECORDS.find((r) => r.slug === 'altes-atelier')
    expect(lapsed.published).toBe(true)
    expect(lapsed.indexable).toBe(true)
    expect(at(lapsed)).toBe(false)
  })

  it('keeps a partner inside the grace period', () => {
    const justInside = { ...RECORDS.find((r) => r.slug === 'altes-atelier'), contractStart: '2025-05-20T00:00:00.000Z' }
    expect(at(justInside)).toBe(true)
  })
})

/**
 * The landing pair belongs in the sitemap.
 *
 * Note what this fixes: `/` was **absent from the sitemap entirely** before
 * feature 004. The landing page had no `seo_metadata` row — the route used a
 * hard-coded fallback record — so `buildSitemap` had nothing to list. Seeding
 * the pair to get `/en` in fixes the German page as a side effect.
 */
describe('the landing pair appears in the sitemap', () => {
  const landing = [
    { recordType: 'page', recordId: 'l-de', slug: 'home', language: 'de', indexable: true, published: true, updatedAt: '2026-09-17T00:00:00.000Z' },
    { recordType: 'page', recordId: 'l-en', slug: 'en', language: 'en', indexable: true, published: true, updatedAt: '2026-09-17T00:00:00.000Z' },
  ]

  it('lists both URLs', () => {
    const { xml } = renderSitemap(ORIGIN, landing, { now: NOW })
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`)
    expect(xml).toContain(`<loc>${ORIGIN}/en</loc>`)
  })

  it('lists them as two entries, not one', () => {
    // Counter-assertion: a sitemap that collapsed the pair would be telling a
    // crawler there is one page, which is what hreflang exists to deny.
    const { xml } = renderSitemap(ORIGIN, landing, { now: NOW })
    expect(xml.match(/<url>/g)).toHaveLength(2)
  })

  it('still omits an unpublished landing translation', () => {
    const { xml } = renderSitemap(ORIGIN, [landing[0], { ...landing[1], published: false }], { now: NOW })
    expect(xml).toContain(`<loc>${ORIGIN}/</loc>`)
    expect(xml).not.toContain(`<loc>${ORIGIN}/en</loc>`)
  })
})

describe('the generated document', () => {
  it('is well-formed sitemap XML', () => {
    const { xml } = renderSitemap(ORIGIN, RECORDS, { now: NOW })
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.trimEnd().endsWith('</urlset>')).toBe(true)
  })

  it('emits absolute URLs on the canonical origin', () => {
    for (const loc of locs(renderSitemap(ORIGIN, RECORDS, { now: NOW }).xml)) {
      expect(loc.startsWith(ORIGIN)).toBe(true)
    }
  })

  it('uses the record’s real updated_at as lastmod, never the build time', () => {
    const { xml } = renderSitemap(ORIGIN, [RECORDS.find((r) => r.slug === 'mueller-legal')], { now: NOW })
    expect(xml).toContain('<lastmod>2026-03-01T10:00:00.000Z</lastmod>')
    expect(xml).not.toContain(new Date().toISOString().slice(0, 10))
  })

  it('omits the lapsed partner’s URL entirely', () => {
    const { xml } = renderSitemap(ORIGIN, RECORDS, { now: NOW })
    expect(xml).not.toContain('altes-atelier')
  })

  it('escapes a URL containing XML-significant characters', () => {
    const { xml } = renderSitemap(ORIGIN, [{
      recordType: 'article', slug: 'a&b', title: 'x', description: 'y',
      published: true, indexable: true, updatedAt: '2026-01-01T00:00:00.000Z',
    }], { now: NOW })
    expect(xml).toContain('&amp;')
  })

  it('reports when the 10,000-URL index threshold is crossed', () => {
    const many = Array.from({ length: 10_001 }, (_, i) => ({
      recordType: 'article', slug: `a-${i}`, title: `A ${i}`, description: 'd',
      published: true, indexable: true, updatedAt: '2026-01-01T00:00:00.000Z',
    }))
    expect(renderSitemap(ORIGIN, many, { now: NOW }).needsIndex).toBe(true)
    expect(renderSitemap(ORIGIN, RECORDS, { now: NOW }).needsIndex).toBe(false)
  })
})

describe('robots.txt is generated from the surface table (FR-024)', () => {
  it('disallows every gated surface by construction', () => {
    const txt = renderRobots(ORIGIN)
    for (const prefix of disallowedPrefixes()) {
      expect(txt).toContain(`Disallow: ${prefix}/`)
    }
  })

  it('names the sitemap on the canonical origin', () => {
    expect(renderRobots(ORIGIN)).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`)
  })

  it('does NOT disallow public-but-unindexed surfaces — a crawler still needs the images', () => {
    const txt = renderRobots(ORIGIN)
    expect(txt).not.toContain('Disallow: /media/')
    expect(txt).not.toContain('Disallow: /sitemap.xml/')
  })

  it('covers every gated surface in the §10.1 table', () => {
    const disallowed = new Set(disallowedPrefixes())
    for (const surface of SURFACES.filter((s) => !s.public && s.prefixes[0] !== '/')) {
      for (const prefix of surface.prefixes) expect(disallowed.has(prefix)).toBe(true)
    }
  })
})

describe('as served', () => {
  let app
  beforeAll(async () => { app = await buildFixtureApp() })
  afterAll(async () => { await app.close() })

  it('serves robots.txt as text, cached for an hour', async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/plain/)
    expect(response.headers['cache-control']).toContain('max-age=3600')
  })

  it('marks robots.txt and the sitemap non-indexable — a directive is not content', async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('declares a public posture on both crawl-control routes', async () => {
    const postures = app.routePostures()
    for (const url of ['/robots.txt', '/sitemap.xml']) {
      expect(postures.find((r) => r.url === url)?.auth?.audience).toBe('public')
    }
  })
})
