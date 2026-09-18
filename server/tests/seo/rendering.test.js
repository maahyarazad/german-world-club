import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildFixtureApp, HTML, RECORDS, PUBLIC_PATHS } from '../helpers/fixtures.js'

/**
 * SC-005 / FR-016 / §10.2 — meaningful content in the **initial HTML
 * response**, with no JavaScript executed.
 *
 * `inject` runs no scripts, which is exactly the point: it sees what a link
 * preview bot and most non-Google crawlers see. A client-only strategy passes a
 * browser test and silently costs the club its share links and the partner
 * visibility it has sold.
 */
let app
beforeAll(async () => { app = await buildFixtureApp() })
afterAll(async () => { await app.close() })

const published = RECORDS.filter((r) => r.published)
const pathFor = (r) => PUBLIC_PATHS[r.recordType](r.slug)

describe('server-rendered public content (SC-005)', () => {
  it.each(published.map((r) => [pathFor(r), r]))('%s carries its real content in the raw body', async (path, record) => {
    const response = await app.inject({ method: 'GET', url: path, headers: HTML })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<h1')
    expect(response.body).toContain(record.title)
    expect(response.body).toContain(record.description)
  })

  it('serves the landing page with content, not an empty shell (FR-016)', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: HTML })
    expect(response.statusCode).toBe(200)
    expect(response.body.length).toBeGreaterThan(500)
    expect(response.body).toMatch(/<h1|id="boot"/)
  })

  it('declares the document language on every page (§10.7)', async () => {
    for (const record of published) {
      const response = await app.inject({ method: 'GET', url: pathFor(record), headers: HTML })
      expect(response.body).toContain(`<html lang="${record.language}">`)
    }
  })

  it('renders a partner listing with address, hours and discount (§5)', async () => {
    const response = await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })
    expect(response.body).toContain('Sheikh Zayed Road 12')
    expect(response.body).toContain('Mo-Fr 09:00-17:00')
    expect(response.body).toContain('15')
  })

  it('renders an event with its date, venue and registration state (§4)', async () => {
    const response = await app.inject({ method: 'GET', url: '/events/sommerfest-2026', headers: HTML })
    expect(response.body).toContain('Club-Terrasse')
    expect(response.body).toContain('2026-07-01T16:00:00.000Z')
    expect(response.body).toMatch(/Anmeldung/)
  })

  it('renders an article with its byline and publication date', async () => {
    const response = await app.inject({ method: 'GET', url: '/magazine/leben-in-dubai', headers: HTML })
    expect(response.body).toContain('Redaktion')
    expect(response.body).toContain('2026-02-01T00:00:00.000Z')
  })

  it('escapes interpolated content — a quote in a name must not break out of an attribute', async () => {
    const hostile = [{
      recordType: 'partner', recordId: 'x', slug: 'hostile',
      title: 'The "Best" <script>alert(1)</script> Kanzlei',
      description: 'Ein Test mit & < > " Zeichen.',
      language: 'de', indexable: true, published: true, sections: [],
    }]
    const scoped = await buildFixtureApp(hostile)
    try {
      const response = await scoped.inject({ method: 'GET', url: '/partners/hostile', headers: HTML })
      expect(response.body).not.toContain('<script>alert(1)</script>')
      expect(response.body).toContain('&lt;script&gt;')
      expect(response.body).toContain('&quot;Best&quot;')
    } finally {
      await scoped.close()
    }
  })

  it('never partially renders gated content to an anonymous visitor (FR-026)', async () => {
    for (const path of ['/portal/profile', '/threads/1', '/marketplace/listing-1']) {
      const response = await app.inject({ method: 'GET', url: path, headers: HTML })
      expect(response.statusCode).not.toBe(200)
    }
  })

  it('sets a public cache policy and varies on language (§10.7, §10.9)', async () => {
    const response = await app.inject({ method: 'GET', url: '/partners/mueller-legal', headers: HTML })
    expect(response.headers['cache-control']).toContain('max-age=300')
    expect(response.headers.vary).toContain('Accept-Language')
    expect(response.headers['content-language']).toBe('de')
  })
})
