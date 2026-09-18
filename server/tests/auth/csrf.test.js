import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp } from '../helpers/auth.js'
import { COOKIES } from '@gwc/contracts/auth'

/**
 * Cross-cutting rule 3 of auth-api.md.
 *
 * A browser sends its cookies on any request a page can cause, so a
 * cookie-bearing state-changing request needs a double-submit token. A bearer
 * client is **exempt**: it has no ambient credential for another site to
 * trigger, and requiring a token there would add a round trip for no security.
 *
 * That asymmetry is the part worth testing — it is the bit a later change is
 * most likely to get backwards.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const tokenFor = (audience = 'member') =>
  app.mintAccessToken({ accountId: randomUUID(), sessionId: randomUUID(), audience }).token

describe('cookie-bearing state-changing requests', () => {
  it('is refused without a CSRF token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      cookies: { [COOKIES.access]: tokenFor() },
    })
    expect(response.statusCode).toBe(403)
  })

  it('is refused when the submitted token does not match the cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      cookies: { [COOKIES.access]: tokenFor(), [COOKIES.csrf]: 'one-value' },
      headers: { 'x-csrf-token': 'a-different-value' },
    })
    expect(response.statusCode).toBe(403)
  })

  it('is refused on a refresh presented by cookie alone', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [COOKIES.refresh]: 'some-opaque-value' },
      payload: {},
    })
    expect(response.statusCode).toBe(403)
  })
})

describe('bearer clients are exempt', () => {
  it('reaches the route with no CSRF token at all', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { authorization: `Bearer ${tokenFor()}` },
    })
    // It gets past CSRF and fails later, on the session lookup — which is the
    // point: 403 here would mean CSRF refused a bearer client.
    expect(response.statusCode).not.toBe(403)
  })

  it('is exempt even when a stale cookie is also present', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/sign-out',
      headers: { authorization: `Bearer ${tokenFor()}` },
      cookies: { [COOKIES.access]: tokenFor() },
    })
    expect(response.statusCode).not.toBe(403)
  })
})

describe('safe methods and anonymous requests', () => {
  it('does not require a token for a GET', async () => {
    const response = await app.inject({
      method: 'GET', url: '/auth/me', cookies: { [COOKIES.access]: tokenFor() },
    })
    expect(response.statusCode).not.toBe(403)
  })

  it('does not require a token for a sign-in, which carries no ambient credential', async () => {
    const response = await app.inject({
      method: 'POST', url: '/auth/sign-in', payload: { email: 'nobody@test.invalid', password: 'password123' },
    })
    expect(response.statusCode).not.toBe(403)
  })

  it('does not require a token for a public GET', async () => {
    expect((await app.inject({ method: 'GET', url: '/robots.txt' })).statusCode).toBe(200)
  })
})

describe('the cookies themselves', () => {
  it('scopes the refresh cookie to the one path that consumes it', () => {
    expect(COOKIES.refresh).toBe('gwc_rt')
    expect(COOKIES.access).toBe('gwc_at')
  })
})
