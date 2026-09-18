import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'

/**
 * The console's SPA fallback (T010, research R9).
 *
 * `@fastify/static` is registered `wildcard: false` precisely so an unmatched
 * path produces a real 404 rather than a 200 carrying the wrong page — the
 * rule Constitution Principle III states and the existing not-found suite
 * proves. A client-routed console needs the opposite behaviour for its own
 * prefix, which makes this the single most dangerous change in the feature:
 * widen it by one character and 404 correctness is gone across the whole
 * origin, silently.
 *
 * So the positive assertions here are the small half. The counter-assertions —
 * that everything outside `/konsole` still 404s — are the point.
 */
describe('the console shell is served under its own prefix', () => {
  let app
  beforeAll(async () => {
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()
  })
  afterAll(async () => { await app.close() })

  it.each([
    ['the bare prefix', '/konsole'],
    ['a portal root', '/konsole/admin'],
    ['a deep link', '/konsole/admin/seo/irgendwas'],
    ['a path the router does not know either', '/konsole/gibt-es-nicht'],
  ])('serves the shell for %s', async (_name, url) => {
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/text\/html/)
    expect(response.body).toMatch(/<div id="root">/)
  })

  /**
   * THE counter-assertion. If this ever fails, the fallback has eaten the
   * origin's 404s and Principle III is broken everywhere, not just here.
   */
  it.each([
    ['a bare unknown path', '/gibt-es-nicht'],
    ['an unknown path under a real public prefix', '/events/gibt-es-nicht'],
    ['a near-miss on the prefix', '/konsolen'],
    ['a near-miss the other way', '/konsol'],
    ['an unknown admin path', '/admin/gibt-es-nicht'],
  ])('STILL returns a real 404 for %s', async (_name, url) => {
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toMatch(/<div id="root">/)
  })

  it('is never indexed', async () => {
    const response = await app.inject({ method: 'GET', url: '/konsole/admin' })
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('is disallowed in robots.txt', async () => {
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(robots.body).toMatch(/Disallow: \/konsole/)
  })

  /**
   * The shell is served by a route declared `audience: 'public'`, which is only
   * defensible because the shell contains nothing. If a future change inlines a
   * principal, a capability set or any member data into it to save a round
   * trip, that declaration becomes a disclosure (Principle VI).
   */
  it('carries no member content, no capability data and no principal identity', async () => {
    const body = (await app.inject({ method: 'GET', url: '/konsole/admin' })).body

    expect(body).not.toMatch(/@/) // no address of any kind
    expect(body).not.toMatch(/\b(members|marketplace_moderation|mass_messages)\b/)
    expect(body).not.toMatch(/isSuperadmin|displayName|modules/)
    // Counter-assertion: the body is not empty — the assertions above must be
    // passing because the shell is clean, not because there is nothing to scan.
    expect(body.length).toBeGreaterThan(200)
  })

  it('declares the posture the startup gate requires', () => {
    const routes = app.routePostures().filter((r) => r.url.startsWith('/konsole'))
    expect(routes.length).toBeGreaterThan(0)
    for (const route of routes) {
      expect(route.auth, `${route.method} ${route.url}`).toEqual({ audience: 'public' })
    }
  })
})
