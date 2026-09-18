import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildPageMeta, pathFor } from '../../src/modules/seo/build-page-meta.ts'
import { postureFor } from '../../src/modules/seo/surfaces.ts'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The landing pair, from the server's side.
 *
 * `hreflang.test.js` already proves the *mechanism* — alternates derived from a
 * translation group are reciprocal, hrefs are absolute, `x-default` points at
 * German. This file proves the mechanism was actually applied to the two
 * landing pages, which is a different claim and the one that was missing.
 */

const ORIGIN = 'https://german-world-club.test'

/** Exactly what `server/src/modules/public/routes.js` hands to `buildPageMeta`. */
const ALTERNATES = [
  { language: 'de', slug: 'home', recordType: 'page' },
  { language: 'en', slug: 'en', recordType: 'page' },
]

const record = (language, slug) => ({
  recordType: 'page',
  recordId: `landing-${language}`,
  slug,
  title: language === 'de' ? 'German World Club' : 'German World Club',
  description: 'x',
  language,
  indexable: true,
  published: true,
  sections: [],
})

describe('the landing slugs resolve to the right URLs', () => {
  it('maps the German landing page to the site root', () => {
    // `slug: 'home'` is the one slug pathFor sends to `/`. It is why the German
    // landing page is the root rather than `/home`.
    expect(pathFor('page', 'home')).toBe('/')
  })

  it('maps the English landing page to /en with no special case', () => {
    // A `page` record has an empty prefix, so the slug IS the path. No routing
    // concept was added for this.
    expect(pathFor('page', 'en')).toBe('/en')
  })
})

describe('hreflang for the pair', () => {
  const de = buildPageMeta(record('de', 'home'), { origin: ORIGIN, alternates: ALTERNATES })
  const en = buildPageMeta(record('en', 'en'), { origin: ORIGIN, alternates: ALTERNATES })

  const hrefs = (meta) =>
    meta.alternates.filter((a) => a.hreflang !== 'x-default').map((a) => a.href).sort()

  it('names both languages from each page', () => {
    expect(de.alternates.map((a) => a.hreflang)).toEqual(expect.arrayContaining(['de', 'en']))
    expect(en.alternates.map((a) => a.hreflang)).toEqual(expect.arrayContaining(['de', 'en']))
  })

  it('is reciprocal — a one-directional declaration is ignored and suppresses both', () => {
    expect(hrefs(de)).toEqual(hrefs(en))
  })

  it('points the alternates at / and /en', () => {
    expect(hrefs(de)).toEqual([`${ORIGIN}/`, `${ORIGIN}/en`])
  })

  it('points x-default at the German page (§10.7)', () => {
    for (const meta of [de, en]) {
      const xd = meta.alternates.find((a) => a.hreflang === 'x-default')
      expect(xd?.href).toBe(`${ORIGIN}/`)
    }
  })

  /**
   * The line that matters most in this feature.
   *
   * Canonicalising a translation onto its original tells a crawler "index the
   * other one", which delists the English page entirely. `hreflang` exists to
   * express the relationship `rel=canonical` destroys.
   */
  it('gives each page its OWN canonical, never the other page', () => {
    expect(de.canonical).toBe(`${ORIGIN}/`)
    expect(en.canonical).toBe(`${ORIGIN}/en`)
    expect(en.canonical).not.toBe(de.canonical)
  })
})

describe('both landing pages are public and indexed', () => {
  it.each([
    ['/', 'landing'],
    ['/en', 'landing-en'],
  ])('%s is declared indexable in the crawl-posture table', (url, name) => {
    const posture = postureFor({ audience: 'public' }, url)
    expect(posture.name).toBe(name)
    expect(posture.public).toBe(true)
    expect(posture.indexed).toBe(true)
  })

  /**
   * Counter-assertion, and the reason `/en` needed its own row.
   *
   * The table is matched by prefix and the landing row's prefix is `/`, which
   * matches only the root exactly. Without a row of its own, `/en` would fall
   * through to the gated default and be marked noindex — delisting the very
   * page it exists to publish.
   */
  it('STILL treats an undeclared path as gated', () => {
    const posture = postureFor(undefined, '/eine-seite-die-niemand-deklariert-hat')
    expect(posture.public).toBe(false)
    expect(posture.indexed).toBe(false)
  })
})

describe('both landing pages are served, and the URL decides the language', () => {
  let app: GwcApp
  beforeAll(async () => {
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
  })
  afterAll(async () => { await app.close() })

  it.each([['/'], ['/en']])('%s answers 200 with HTML', async (url) => {
    const response = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.body.length).toBeGreaterThan(500)
  })

  it.each([
    ['/', 'de'],
    ['/en', 'en'],
  ])('%s declares lang="%s"', async (url, language) => {
    const response = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
    expect(response.body).toContain(`<html lang="${language}">`)
  })

  /**
   * FR-013. Two URLs that can serve the same body compete as duplicates, cache
   * badly, and answer a crawler differently from a visitor.
   */
  it.each([
    ['/', 'de', 'en-GB,en;q=0.9'],
    ['/en', 'en', 'de-DE,de;q=0.9'],
  ])('%s still answers lang="%s" when Accept-Language asks for the other', async (url, language, header) => {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: { accept: 'text/html', 'accept-language': header },
    })
    expect(response.body).toContain(`<html lang="${language}">`)
  })

  it('neither page is marked noindex', async () => {
    for (const url of ['/', '/en']) {
      const response = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
      expect(response.headers['x-robots-tag'] ?? '', url).not.toMatch(/noindex/)
    }
  })

  it('does not redirect one language to the other', async () => {
    // A redirect would collapse the pair back into one indexable URL.
    for (const url of ['/', '/en']) {
      const response = await app.inject({ method: 'GET', url, headers: { accept: 'text/html' } })
      expect(response.statusCode, url).not.toBe(301)
      expect(response.statusCode, url).not.toBe(302)
    }
  })
})
