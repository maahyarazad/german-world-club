import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp } from '../helpers/auth.ts'

/**
 * FR-003 — audience separation is structural.
 *
 * A member's token fails on a staff route **at verification, before any handler
 * runs**. That is the difference between a rule and a convention: a per-route
 * check is something a route added under time pressure can omit, and this is
 * not.
 *
 * None of these assertions touches the database, because none of them should
 * need to: the refusal happens before a handler, and therefore before a query.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const tokenFor = (audience) =>
  app.mintAccessToken({ accountId: randomUUID(), sessionId: randomUUID(), audience }).token

const STAFF_ROUTES = ['/auth/staff/me', '/admin/seo/partner/00000000-0000-4000-8000-000000000000']
const MEMBER_ROUTES = ['/auth/me']

describe('a member token on a staff route (FR-003)', () => {
  it.each(STAFF_ROUTES)('is refused at %s', async (url) => {
    const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokenFor('member')}` } })
    expect(response.statusCode).toBe(403)
  })

  it('is a 403, not a 401 — the credential is valid, it is for another interface', async () => {
    const response = await app.inject({
      method: 'GET', url: '/auth/staff/me', headers: { authorization: `Bearer ${tokenFor('member')}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toMatch(/insufficient-permission/)
  })

  it('fails before any handler runs — no database is consulted', async () => {
    // The whole suite runs with no reachable database. If the audience check
    // happened inside a handler, this would be a 500.
    const response = await app.inject({
      method: 'GET', url: '/auth/staff/me', headers: { authorization: `Bearer ${tokenFor('member')}` },
    })
    expect(response.statusCode).not.toBe(500)
  })
})

describe('a staff token on a member route', () => {
  it.each(MEMBER_ROUTES)('is refused at %s', async (url) => {
    const response = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${tokenFor('admin')}` } })
    expect(response.statusCode).toBe(403)
  })
})

describe('no token at all', () => {
  it('is a 401 on a member route — a missing credential, not a wrong one', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me' })
    expect(response.statusCode).toBe(401)
    expect(response.json().type).toMatch(/unauthenticated/)
  })

  it('is a 401 on a staff route', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/staff/me' })
    expect(response.statusCode).toBe(401)
  })

  it('leaves public routes reachable', async () => {
    expect((await app.inject({ method: 'GET', url: '/robots.txt' })).statusCode).toBe(200)
  })
})

describe('malformed and mistyped credentials', () => {
  it('refuses a token that is not an access token', async () => {
    const claims = { sub: randomUUID(), sid: randomUUID(), aud: 'member', typ: 'refresh', jti: 'x'.repeat(26), iat: 1, exp: 2 ** 31 }
    const token = app.jwt.sign(claims, { algorithm: 'EdDSA' })
    const response = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(401)
  })

  it('refuses a garbage bearer value', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Bearer not.a.token' } })
    expect(response.statusCode).toBe(401)
  })

  it('refuses an expired token, allowing only the documented 30 s of skew', async () => {
    const past = Date.now() - 3600_000
    const { token } = app.mintAccessToken({ accountId: randomUUID(), sessionId: randomUUID(), audience: 'member', now: past })
    const response = await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Bearer ${token}` } })
    expect(response.statusCode).toBe(401)
  })
})

describe('every gated surface is marked non-indexable as well (FR-025, SC-008)', () => {
  const gated = ['/auth/me', '/auth/staff/me', '/admin/seo/partner/00000000-0000-4000-8000-000000000000']

  it.each(gated)('%s carries noindex and no-store', async (url) => {
    const response = await app.inject({ method: 'GET', url })
    // Both halves, as §10.1 requires: access control AND a crawl directive,
    // because URL shapes leak through referrers and shared links regardless of
    // whether the content is reachable.
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.headers['cache-control']).toContain('no-store')
  })
})
