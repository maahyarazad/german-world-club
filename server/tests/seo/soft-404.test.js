import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BAD_PATHS } from '../fixtures/bad-paths.js'
import { buildFixtureApp, HTML } from '../helpers/fixtures.js'

/**
 * SC-004 — the headline regression.
 *
 * Before this feature, `setNotFoundHandler` answered every unknown non-`/api`
 * path with `index.html` at HTTP 200. §10.6 and §12.13 name that defect
 * explicitly and ask for it to be "explicitly prevented and regression-tested";
 * this corpus is that test.
 *
 * A 301 counts as a pass for a path that is merely a *form* variant of another
 * URL (upper case, trailing slash) — canonicalisation runs before routing, and
 * following it lands on a 404. What must never happen is a 200.
 */
let app
beforeAll(async () => { app = await buildFixtureApp() })
afterAll(async () => { await app.close() })

const follow = async (path) => {
  let response = await app.inject({ method: 'GET', url: path, headers: HTML })
  // At most one canonical hop: the canonical form is by construction canonical.
  if (response.statusCode === 301) {
    const next = new URL(response.headers.location)
    response = await app.inject({ method: 'GET', url: `${next.pathname}${next.search}`, headers: HTML })
  }
  return response
}

describe('the soft-404 is gone (SC-004)', () => {
  /**
   * The requirement is that no bad path returns content *at that URL*. A form
   * variant — upper case, a trailing slash, a tracking query on a real page —
   * legitimately 301s to its canonical form; what must never happen is a 200
   * at the requested URL, because that is what mints a duplicate indexable URL.
   */
  it.each(BAD_PATHS)('never answers 200 at %s', async (path) => {
    const response = await app.inject({ method: 'GET', url: path, headers: HTML })
    expect(response.statusCode).not.toBe(200)
    if (response.statusCode === 301) {
      expect(response.headers.location).not.toBe(path)
    } else {
      expect(response.statusCode).toBe(404)
    }
  })

  it('runs a corpus of at least 50 paths, as §10.6 asks', () => {
    expect(BAD_PATHS.length).toBeGreaterThanOrEqual(50)
  })

  it('never serves the application shell as a fallback', async () => {
    for (const path of ['/nonsense', '/wp-login.php', '/partners/deleted-partner']) {
      const response = await follow(path)
      expect(response.body).not.toContain('id="root"')
      expect(response.body).not.toContain('Experts Circle')
    }
  })

  it('marks the 404 page non-indexable — an error page must not be listed', async () => {
    const response = await follow('/nonsense')
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.body).toContain('noindex')
  })

  it('answers an API 404 with problem+json rather than HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nothing', headers: { accept: 'application/json' } })
    expect(response.statusCode).toBe(404)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
  })

  it('404s an unpublished record rather than leaking a draft', async () => {
    const response = await follow('/magazine/noch-nicht-fertig')
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toContain('unveröffentlichter Entwurf')
  })

  it('still serves the real pages — the corpus is not passing by 404ing everything', async () => {
    for (const path of ['/', '/partners/mueller-legal', '/events/sommerfest-2026', '/robots.txt']) {
      const response = await follow(path)
      expect(response.statusCode).toBe(200)
    }
  })
})
