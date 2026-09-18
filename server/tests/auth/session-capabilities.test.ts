import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildAuthApp, createAdmin, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * GET /auth/session — what the console boots from.
 *
 * The property under test is not "it returns some JSON". It is that a staff
 * member holding *one narrow grant* can read their own capability set, because
 * that is what was impossible before this route existed and what User Story 1
 * cannot be built without.
 *
 * Every positive assertion is paired with the refusal that proves it is not
 * simply open.
 */

describe('the session route is reachable without holding a module', () => {
  let app
  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  it('refuses an anonymous caller', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/session' })
    expect(response.statusCode).toBe(401)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
  })

  it('declares the anyStaff posture rather than a module', async () => {
    const route = app.routePostures().find((r) => r.url === '/auth/session' && r.method === 'GET')
    expect(route.auth).toEqual({ audience: 'staff', anyStaff: true })
    // Counter-assertion: the staff profile route beside it is UNCHANGED. This
    // route was added; nothing was relaxed.
    const profile = app.routePostures().find((r) => r.url === '/auth/staff/me' && r.method === 'GET')
    expect(profile.auth).toEqual({ audience: 'staff', module: 'settings', flag: 'read' })
  })

  it('never caches — the snapshot is per-principal', async () => {
    const response = await app.inject({ method: 'GET', url: '/auth/session' })
    expect(response.headers['cache-control']).toMatch(/no-store/)
  })
})

describe.skipIf(!hasDatabase)('the snapshot describes the principal, and only them', () => {
  let app
  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterAll(async () => { await app.close() })

  /**
   * The whole point of the route. Before it existed this account was refused
   * its own capability set, because the only snapshot endpoint required
   * `settings.read`.
   */
  it('answers a staff member holding only seo.read', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const response = await app.inject({ method: 'GET', url: '/auth/session', headers: auth })
    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.kind).toBe('staff')
    expect(body.modules.seo.read).toBe(true)
    expect(body.modules.seo.edit).toBe(false)

    // Counter-assertion: the same account is STILL refused the settings-gated
    // profile route. The exemption is scoped to this one route, not to staff
    // routes generally.
    const profile = await app.inject({ method: 'GET', url: '/auth/staff/me', headers: auth })
    expect(profile.statusCode).toBe(403)
  })

  /**
   * Absence is denial everywhere else in this system and must mean the same
   * here. Nineteen all-false objects would say nothing while inviting the
   * console to render a sidebar entry for every module in existence.
   */
  it('omits modules where every flag is false', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const body = (await app.inject({ method: 'GET', url: '/auth/session', headers: auth })).json()
    expect(Object.keys(body.modules)).toEqual(['seo'])
    expect(body.modules).not.toHaveProperty('members')
    expect(body.modules).not.toHaveProperty('settings')
  })

  it('renders an empty matrix for a staff account holding nothing', async () => {
    // The counter-assertion account. A console that showed a full sidebar here
    // would have a defect no positive test could catch.
    const admin = await createAdmin(app.pg, { grants: {} })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const response = await app.inject({ method: 'GET', url: '/auth/session', headers: auth })
    expect(response.statusCode).toBe(200)
    expect(response.json().modules).toEqual({})
  })

  it('reports a superadmin as holding every flag', async () => {
    const admin = await createAdmin(app.pg, { isSuperadmin: true })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const body = (await app.inject({ method: 'GET', url: '/auth/session', headers: auth })).json()
    expect(body.isSuperadmin).toBe(true)
    // A superadmin bypasses the matrix at enforcement time, so the console
    // needs the *effective* answer rather than the stored rows — otherwise it
    // would render an empty sidebar for the one account that may do everything.
    expect(Object.keys(body.modules).length).toBeGreaterThan(0)
    for (const grant of Object.values(body.modules)) {
      expect(grant.read).toBe(true)
      expect(grant.delete).toBe(true)
    }
  })

  it('refuses a member credential as wrong-audience, not as unauthenticated', async () => {
    const member = await createMember(app.pg)
    const auth = await bearerFor(app, { accountId: member.id, accountKind: 'member' })

    const response = await app.inject({ method: 'GET', url: '/auth/session', headers: auth })
    // 403, not 401: the credential is valid, it is simply not for this
    // interface, and re-authenticating cannot help.
    expect(response.statusCode).toBe(403)
  })

  it('lists only modules the server can actually serve', async () => {
    const admin = await createAdmin(app.pg, { isSuperadmin: true })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const body = (await app.inject({ method: 'GET', url: '/auth/session', headers: auth })).json()

    // Derived from the registered routes, so these three are present because
    // routes declare them...
    expect(body.available).toContain('seo')
    expect(body.available).toContain('settings')
    expect(body.available).toContain('mass_messages')

    // ...and the counter-assertion: sixteen modules have no endpoint yet, and
    // the console must be told so rather than rendering dead links (SC-001).
    expect(body.available).not.toContain('committees')
    expect(body.available).not.toContain('magazine')
    expect(body.available.length).toBeLessThan(Object.keys(body.modules).length)
  })
})
