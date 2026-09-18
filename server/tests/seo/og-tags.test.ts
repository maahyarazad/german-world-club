import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildFixtureApp, HTML } from '../helpers/fixtures.ts'

/**
 * FR-018 — the share-preview surface.
 *
 * §10.3 asks for "OG tag handlers"; the implementation is one resolver plus one
 * serializer, and this suite asserts what actually reaches the wire. A missing
 * `og:image:width` is not cosmetic: a preview bot given an image URL with no
 * dimensions renders a broken card, on exactly the links the club's members
 * share.
 */
let app
beforeAll(async () => { app = await buildFixtureApp() })
afterAll(async () => { await app.close() })

const tags = (body) => {
  const found = new Map()
  const re = /<meta\s+(?:property|name)="((?:og|twitter):[^"]+)"\s+content="([^"]*)">/g
  for (const [, key, value] of body.matchAll(re)) found.set(key, value)
  return found
}

describe('Open Graph and Twitter tags (FR-018)', () => {
  it('emits the full tag set on a partner page', async () => {
    const body = (await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })).body
    const t = tags(body)
    for (const key of [
      'og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:locale',
      'og:image', 'og:image:width', 'og:image:height', 'og:image:alt',
      'twitter:card', 'twitter:title', 'twitter:description', 'twitter:image',
    ]) {
      expect(t.has(key), `missing ${key}`).toBe(true)
      expect(t.get(key)).not.toBe('')
    }
  })

  it('uses absolute URLs on the canonical origin — a relative og:image breaks every bot', async () => {
    const body = (await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })).body
    const t = tags(body)
    const origin = app.env.canonicalOrigin
    expect(t.get('og:url').startsWith(origin)).toBe(true)
    expect(t.get('og:image').startsWith(origin)).toBe(true)
    expect(t.get('twitter:image').startsWith(origin)).toBe(true)
  })

  it('states explicit image dimensions and alt text', async () => {
    const t = tags((await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })).body)
    expect(Number(t.get('og:image:width'))).toBeGreaterThan(0)
    expect(Number(t.get('og:image:height'))).toBeGreaterThan(0)
    expect(t.get('og:image:alt').length).toBeGreaterThan(0)
  })

  it('references a derived variant, never a stored original (FR-060)', async () => {
    const t = tags((await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })).body)
    expect(new URL(t.get('og:image')).pathname).toMatch(/^\/media\/[^/]+\/(thumb|small|medium|large)\.(webp|png|jpeg)$/)
  })

  it('uses summary_large_image, the card the club’s share links need', async () => {
    const t = tags((await app.inject({ method: 'GET', url: '/magazine/leben-in-dubai', headers: HTML })).body)
    expect(t.get('twitter:card')).toBe('summary_large_image')
  })

  it('sets og:type per record type', async () => {
    const partner = tags((await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })).body)
    const article = tags((await app.inject({ method: 'GET', url: '/magazine/leben-in-dubai', headers: HTML })).body)
    expect(partner.get('og:type')).toBe('business.business')
    expect(article.get('og:type')).toBe('article')
  })

  it('omits the image tags entirely rather than emitting an incomplete set', async () => {
    // The committee fixture carries no share image.
    const t = tags((await app.inject({ method: 'GET', url: '/committees/kulturkomitee', headers: HTML })).body)
    expect(t.has('og:image')).toBe(false)
    expect(t.has('og:image:width')).toBe(false)
    expect(t.has('og:title')).toBe(true)
  })

  it('emits a canonical link on every public page', async () => {
    const body = (await app.inject({ method: 'GET', url: '/events/sommerfest-2026', headers: HTML })).body
    expect(body).toContain(`<link rel="canonical" href="${app.env.canonicalOrigin}/events/sommerfest-2026">`)
  })

  it('marks a record that opted out of indexing as noindex', async () => {
    const body = (await app.inject({ method: 'GET', url: '/magazine/intern-aber-oeffentlich', headers: HTML })).body
    expect(body).toContain('<meta name="robots" content="noindex,nofollow">')
  })

  it('stops advertising a lapsed partner while still serving the page (FR-031)', async () => {
    const response = await app.inject({ method: 'GET', url: '/partners/altes-atelier', headers: HTML })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<meta name="robots" content="noindex,nofollow">')
    expect(response.body).toContain('nicht aktiv')
  })
})
