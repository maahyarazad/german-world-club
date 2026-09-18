import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildFixtureApp, HTML } from '../helpers/fixtures.ts'
import { canonicalise, normaliseHost, MEANINGFUL_PARAMS } from '../../src/plugins/03-canonical-origin.ts'
import { normalisePath } from '../../src/plugins/04-legacy-redirects.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-028 / FR-029 / §10.6.
 *
 * Every duplicate form of a URL splits the same content's ranking signals
 * across several addresses. For a partner listing the club has sold, that is
 * lost visibility rather than a cosmetic detail — so the variants 301, before
 * routing, and they do it permanently.
 */
let app: GwcApp
beforeAll(async () => { app = await buildFixtureApp() })
afterAll(async () => { await app.close() })

const ORIGIN = 'https://german-world-club.test'

describe('canonicalise (FR-028)', () => {
  it('redirects a non-canonical host', () => {
    expect(canonicalise('/partners/x', { host: 'www.other.test', protocol: 'https' }, ORIGIN))
      .toBe(`${ORIGIN}/partners/x`)
  })

  it('redirects a non-canonical scheme', () => {
    expect(canonicalise('/partners/x', { host: 'german-world-club.test', protocol: 'http' }, ORIGIN))
      .toBe(`${ORIGIN}/partners/x`)
  })

  it('lower-cases the path', () => {
    expect(canonicalise('/Partners/X', { host: 'german-world-club.test', protocol: 'https' }, ORIGIN))
      .toBe(`${ORIGIN}/partners/x`)
  })

  it('applies one trailing-slash convention and collapses doubled slashes', () => {
    const at = (url) => canonicalise(url, { host: 'german-world-club.test', protocol: 'https' }, ORIGIN)
    expect(at('/partners/x/')).toBe(`${ORIGIN}/partners/x`)
    expect(at('/partners//x')).toBe(`${ORIGIN}/partners/x`)
    expect(at('/')).toBeNull()
  })

  it('strips a parameter that does not change the content', () => {
    expect(canonicalise('/partners/x?utm_source=newsletter', { host: 'german-world-club.test', protocol: 'https' }, ORIGIN))
      .toBe(`${ORIGIN}/partners/x`)
  })

  it('keeps the canonical form untouched — no redirect loop', () => {
    expect(canonicalise('/partners/x', { host: 'german-world-club.test', protocol: 'https' }, ORIGIN)).toBeNull()
  })

  it('treats a spelled-out default port as the same host', () => {
    expect(normaliseHost('example.test:443', 'https')).toBe('example.test')
    expect(normaliseHost('example.test:80', 'http')).toBe('example.test')
    expect(normaliseHost('example.test:3000', 'http')).toBe('example.test:3000')
  })

  it('leaves content-addressed media paths case-sensitive', () => {
    expect(canonicalise('/media/AbCd/large.webp', { host: 'german-world-club.test', protocol: 'https' }, ORIGIN))
      .toBeNull()
  })

  it('starts with an empty meaningful-parameter allowlist, so an unknown parameter is stripped', () => {
    expect(MEANINGFUL_PARAMS).toEqual([])
  })
})

describe('the redirect as served', () => {
  it('answers 301 — permanent, so the duplicate leaves the index', async () => {
    const response = await app.inject({ method: 'GET', url: '/PARTNERS/mueller-legal', headers: HTML })
    expect(response.statusCode).toBe(301)
    expect(response.headers.location).toBe(`${app.env.canonicalOrigin}/partners/mueller-legal`)
  })

  it('lands on the real page after one hop', async () => {
    const first = await app.inject({ method: 'GET', url: '/partners/mueller-legal/', headers: HTML })
    const second = await app.inject({ method: 'GET', url: new URL(first.headers.location).pathname, headers: HTML })
    expect(second.statusCode).toBe(200)
  })

  it('never redirects a state-changing request — a 301 on a POST can lose the body', async () => {
    const response = await app.inject({ method: 'POST', url: '/PARTNERS/x', headers: HTML })
    expect(response.statusCode).not.toBe(301)
  })

  it('leaves health probes alone, whatever host they use', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live', headers: { host: 'internal.cluster.local' } })
    expect(response.statusCode).toBe(200)
  })
})

describe('legacy redirects (FR-029)', () => {
  it('normalises a legacy path the same way the table constraint requires', () => {
    expect(normalisePath('/Alte//Seite/?x=1')).toBe('/alte/seite')
    expect(normalisePath('/')).toBe('/')
  })

  it('ships with an empty table, so an unmapped path still 404s (plan.md Risk 5)', async () => {
    const response = await app.inject({ method: 'GET', url: '/alte-seite', headers: HTML })
    expect(response.statusCode).toBe(404)
  })

  it('301s a mapped path once the inventory arrives', async () => {
    app.invalidateLegacyRedirects()
    const original = app.resolveLegacyRedirect
    app.resolveLegacyRedirect = async (url) =>
      normalisePath(url) === '/alte-kanzlei-seite' ? { target: '/partners/mueller-legal', status: 301 } : null
    try {
      const response = await app.inject({ method: 'GET', url: '/alte-kanzlei-seite', headers: HTML })
      expect(response.statusCode).toBe(301)
      expect(response.headers.location).toBe(`${app.env.canonicalOrigin}/partners/mueller-legal`)
    } finally {
      app.resolveLegacyRedirect = original
    }
  })

  it('410s content that was deliberately retired, rather than 404ing it', async () => {
    const original = app.resolveLegacyRedirect
    app.resolveLegacyRedirect = async (url) =>
      normalisePath(url) === '/eingestellt' ? { target: '', status: 410 } : null
    try {
      const response = await app.inject({ method: 'GET', url: '/eingestellt', headers: HTML })
      expect(response.statusCode).toBe(410)
    } finally {
      app.resolveLegacyRedirect = original
    }
  })
})
