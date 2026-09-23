import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createMember, signIn, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { seedListing, resetMarketplace, TERMS } from './helpers.ts'
import { COOKIES } from '@gwc/contracts/auth'
import type { GwcApp } from '../../src/app.ts'

/**
 * A real double-submit CSRF token for a cookie-authenticated write.
 *
 * `@fastify/csrf-protection`'s token is cryptographically derived from the
 * secret cookie this same response sets — it is not two matching arbitrary
 * strings — so it has to come from the real `/auth/csrf` route, the same way
 * a browser client gets one.
 */
async function csrfFor(app: GwcApp, accessCookieValue: string) {
  const response = await app.inject({
    method: 'GET', url: '/auth/csrf', cookies: { [COOKIES.access]: accessCookieValue },
  })
  const csrfCookie = response.cookies.find((c) => c.name === COOKIES.csrf)!
  return {
    cookies: { [COOKIES.access]: accessCookieValue, [COOKIES.csrf]: csrfCookie.value },
    headers: { 'x-csrf-token': response.json().csrfToken },
  }
}

/**
 * One API, two faces (US6, FR-031).
 *
 * Cookies for the browser, a bearer token for mobile — Principle I permits the
 * *mechanism* to differ while requiring the authorization *outcome* to be
 * identical. This asserts that identity directly against the two real
 * authentication paths, not by inspecting the route declaration: the same
 * member, the same filters, must see the same listings regardless of which
 * credential carried the request, and a member without `marketplace_post`
 * must be refused on both.
 *
 * The two calls are sequential rather than concurrent — minting a bearer
 * supersedes the account's cookie session (one active session per account,
 * FR-004), the same as a real second sign-in would. That is fine here: no
 * write happens between the two reads, so the corpus is identical for both.
 */

describe.skipIf(!hasDatabase)('the marketplace API answers identically over cookie and bearer auth', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
  })

  it('returns the SAME result set for the same member, same filters', async () => {
    const member = await createMember(app.pg, { permissions: { marketplace_post: true } })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [member.id, TERMS],
    )
    await seedListing(app.pg, { ownerId: member.id, category: 'vehicle', mode: 'offer' })
    await seedListing(app.pg, { ownerId: member.id, category: 'job', mode: 'request' })

    // Face 1: the browser, over a signed cookie from a real sign-in.
    const signedIn = await signIn(app, member.email)
    const accessCookie = signedIn.response.cookies.find((c) => c.name === COOKIES.access)
    expect(accessCookie, 'sign-in did not set an access cookie').toBeTruthy()

    const viaCookie = await app.inject({
      method: 'GET', url: '/marketplace/listings?category=vehicle',
      cookies: { [COOKIES.access]: accessCookie!.value },
    })
    expect(viaCookie.statusCode).toBe(200)

    // Face 2: mobile, over a bearer minted for the same account.
    const bearer = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    const viaBearer = await app.inject({
      method: 'GET', url: '/marketplace/listings?category=vehicle',
      headers: bearer,
    })
    expect(viaBearer.statusCode).toBe(200)

    // Same ids, same order — not just "both 200".
    expect(viaBearer.json().items.map((l: { id: string }) => l.id))
      .toEqual(viaCookie.json().items.map((l: { id: string }) => l.id))
  })

  it('refuses a member WITHOUT marketplace_post, on both faces', async () => {
    const member = await createMember(app.pg) // no permissions granted

    const signedIn = await signIn(app, member.email)
    const accessCookie = signedIn.response.cookies.find((c) => c.name === COOKIES.access)!
    const csrf = await csrfFor(app, accessCookie.value)

    const viaCookie = await app.inject({
      method: 'POST', url: '/marketplace/listings', ...csrf,
      payload: { category: 'general', mode: 'offer', title: 'x', body: 'y', termsVersion: TERMS },
    })
    expect(viaCookie.statusCode).toBe(403)

    const bearer = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    const viaBearer = await app.inject({
      method: 'POST', url: '/marketplace/listings', headers: bearer,
      payload: { category: 'general', mode: 'offer', title: 'x', body: 'y', termsVersion: TERMS },
    })
    expect(viaBearer.statusCode).toBe(403)
  })

  it('ADMITS the same member on both faces once the flag is granted — the counter-assertion', async () => {
    // Without this, the refusal test above would pass against an endpoint
    // that refused every member regardless of the flag.
    const member = await createMember(app.pg, { permissions: { marketplace_post: true } })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [member.id, TERMS],
    )

    const signedIn = await signIn(app, member.email)
    const accessCookie = signedIn.response.cookies.find((c) => c.name === COOKIES.access)!
    const csrf = await csrfFor(app, accessCookie.value)
    const viaCookie = await app.inject({
      method: 'POST', url: '/marketplace/listings', ...csrf,
      payload: { category: 'general', mode: 'offer', title: 'A cookie listing', body: 'Body long enough.', details: { kind: 'product' }, termsVersion: TERMS },
    })
    expect(viaCookie.statusCode).toBe(201)

    const bearer = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    const viaBearer = await app.inject({
      method: 'POST', url: '/marketplace/listings', headers: bearer,
      payload: { category: 'general', mode: 'offer', title: 'A bearer listing', body: 'Body long enough.', details: { kind: 'product' }, termsVersion: TERMS },
    })
    expect(viaBearer.statusCode).toBe(201)
  })
})
