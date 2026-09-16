import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp, createMember, createAdmin, grant, resetAuthTables, bearerFor } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'
import { MODULES, FLAGS } from '@gwc/contracts/permissions'
import { INSTITUTIONAL_SLUGS } from '../../src/public/routes.js'

/**
 * SC-002 — every route class × every principal kind, with zero permitted
 * combinations outside the declared matrix.
 *
 * The table **is** the test. It is written as data rather than as prose so that
 * adding a route without adding a row leaves a route untested — which the
 * posture gate and the coverage assertion below both catch. That is the same
 * deny-by-default discipline the server applies to routes, applied to the
 * tests.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

/**
 * One row per route class this feature registers.
 *
 * `url` is the registered pattern, so the coverage assertion below compares
 * like with like; `probe` is the concrete path a request is sent to.
 */
const ROUTE_CLASSES = [
  { name: 'partner page', url: '/partners/:slug', probe: '/partners/anything', method: 'GET', audience: 'public' },
  { name: 'outlet page', url: '/outlets/:slug', probe: '/outlets/anything', method: 'GET', audience: 'public' },
  { name: 'event page', url: '/events/:slug', probe: '/events/anything', method: 'GET', audience: 'public' },
  { name: 'article page', url: '/magazine/:slug', probe: '/magazine/anything', method: 'GET', audience: 'public' },
  { name: 'committee page', url: '/committees/:slug', probe: '/committees/anything', method: 'GET', audience: 'public' },
  { name: 'landing', url: '/', method: 'GET', audience: 'public' },
  { name: 'robots.txt', url: '/robots.txt', method: 'GET', audience: 'public' },
  { name: 'sitemap.xml', url: '/sitemap.xml', method: 'GET', audience: 'public' },
  { name: 'liveness', url: '/health/live', method: 'GET', audience: 'public' },
  { name: 'readiness', url: '/health/ready', method: 'GET', audience: 'public' },
  { name: 'sign-in', url: '/auth/sign-in', method: 'POST', audience: 'public' },
  { name: 'verify OTP', url: '/auth/verify-otp', method: 'POST', audience: 'public' },
  { name: 'resend OTP', url: '/auth/otp/resend', method: 'POST', audience: 'public' },
  { name: 'refresh', url: '/auth/refresh', method: 'POST', audience: 'public' },
  { name: 'reset request', url: '/auth/password-reset/request', method: 'POST', audience: 'public' },
  { name: 'reset confirm', url: '/auth/password-reset/confirm', method: 'POST', audience: 'public' },
  { name: 'member profile', url: '/auth/me', method: 'GET', audience: 'member' },
  { name: 'member sign-out', url: '/auth/sign-out', method: 'POST', audience: 'member' },
  { name: 'staff profile', url: '/auth/staff/me', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'staff sign-out', url: '/auth/staff/sign-out', method: 'POST', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'SEO read', url: '/admin/seo/:recordType/:recordId', method: 'GET', audience: 'staff', module: 'seo', flag: 'read' },
  { name: 'SEO edit', url: '/admin/seo/:recordType/:recordId', method: 'PATCH', audience: 'staff', module: 'seo', flag: 'edit' },
  // Institutional pages are one route class served at several declared slugs.
  ...INSTITUTIONAL_SLUGS.map((slug) => ({
    name: `institutional /${slug}`, url: `/${slug}`, method: 'GET', audience: 'public',
  })),
]

/** Routes whose handler needs the database, so a 500 here is an environment fact. */
const NEEDS_DATABASE = new Set(['/sitemap.xml', '/health/ready'])

describe('the declared matrix', () => {
  it('matches the route table the server actually registered', () => {
    const declared = app.routePostures()
    for (const route of ROUTE_CLASSES) {
      const found = declared.find(
        (r) => r.url === route.url && [].concat(r.method).includes(route.method),
      )
      expect(found, `${route.method} ${route.url} is not registered`).toBeDefined()
      expect(found.auth.audience).toBe(route.audience)
      if (route.audience === 'staff') {
        expect(found.auth.module).toBe(route.module)
        expect(found.auth.flag).toBe(route.flag)
      }
    }
  })

  /**
   * The coverage assertion. A route registered without a row here is a route
   * nobody asserted the posture of, which is exactly the gap the posture gate
   * exists to prevent at the other end.
   */
  it('has a row for every registered route — adding a route without a row fails here', () => {
    const covered = new Set(ROUTE_CLASSES.map((r) => `${r.method} ${r.url}`))
    const uncovered = app
      .routePostures()
      .flatMap((r) => [].concat(r.method).map((m) => `${m} ${r.url}`))
      // HEAD is registered automatically alongside every GET.
      .filter((k) => !k.startsWith('HEAD '))
      // @fastify/static registers one route per file in the static root; the
      // scope declares their posture in one place (see app.js).
      .filter((k) => !/\.(svg|png|ico|txt|json|webmanifest)$/.test(k) || k.endsWith('/robots.txt'))
      .filter((k) => !covered.has(k))

    expect(uncovered).toEqual([])
  })

  it('declares only known modules and flags on staff routes', () => {
    for (const route of app.routePostures()) {
      if (route.auth.audience !== 'staff') continue
      expect(MODULES).toContain(route.auth.module)
      expect(FLAGS).toContain(route.auth.flag)
    }
  })
})

describe('anonymous reaches public routes and nothing else', () => {
  const gated = ROUTE_CLASSES.filter((r) => r.audience !== 'public')

  it.each(gated.map((r) => [`${r.method} ${r.url}`, r]))('refuses %s', async (_name, route) => {
    const url = (route.probe ?? route.url).replace(':recordType', 'partner').replace(':recordId', randomUUID())
    const response = await app.inject({ method: route.method, url, payload: route.method === 'POST' ? {} : undefined })
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.statusCode).toBeLessThan(500)
  })

  it.each(ROUTE_CLASSES.filter((r) => r.audience === 'public' && r.method === 'GET').map((r) => [r.probe ?? r.url, r]))(
    'admits an anonymous GET to %s',
    async (_url, route) => {
      const response = await app.inject({ method: 'GET', url: route.probe ?? route.url })
      // The claim is that the route was *reached*: 404 for a record that does
      // not exist is a public answer, and so is a 500 from a route whose
      // handler needs a database this run has none of. 401 and 403 would not be.
      expect(response.statusCode).not.toBe(401)
      expect(response.statusCode).not.toBe(403)
      if (!NEEDS_DATABASE.has(route.url)) expect(response.statusCode).toBeLessThan(500)
    },
  )
})

describe.skipIf(!hasDatabase)('the live matrix, per principal kind (SC-002)', () => {
  let member
  let departmentAdmin
  let superadmin

  beforeAll(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
    departmentAdmin = await createAdmin(app.pg, { grants: { settings: { read: true } } })
    superadmin = await createAdmin(app.pg, { isSuperadmin: true })
    app.permissions.invalidateAll()
  })

  const call = async (route, headers) => {
    const url = (route.probe ?? route.url).replace(':recordType', 'partner').replace(':recordId', randomUUID())
    const response = await app.inject({ method: route.method, url, headers, payload: route.method === 'POST' || route.method === 'PATCH' ? {} : undefined })
    return response.statusCode
  }

  const permitted = (status) => status < 401 || status === 404 || status === 409 || status === 422

  it('admits a member to member routes and refuses every staff route', async () => {
    const headers = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    for (const route of ROUTE_CLASSES.filter((r) => r.audience === 'member')) {
      expect(permitted(await call(route, headers)), `member should reach ${route.name}`).toBe(true)
    }
    for (const route of ROUTE_CLASSES.filter((r) => r.audience === 'staff')) {
      expect(await call(route, headers), `member must not reach ${route.name}`).toBe(403)
    }
  })

  it('admits a department admin only where the module flag is granted', async () => {
    const headers = await bearerFor(app, { accountId: departmentAdmin.id, accountKind: 'admin' })
    // settings.read was granted; seo.* was not — absence is denial.
    expect(permitted(await call(ROUTE_CLASSES.find((r) => r.name === 'staff profile'), headers))).toBe(true)
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO read'), headers)).toBe(403)
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO edit'), headers)).toBe(403)
  })

  it('admits a superadmin everywhere, with no module row at all (FR-008)', async () => {
    const headers = await bearerFor(app, { accountId: superadmin.id, accountKind: 'admin' })
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM admin_permissions WHERE admin_user_id = $1', [superadmin.id])
    expect(rows[0].n).toBe(0)
    for (const route of ROUTE_CLASSES.filter((r) => r.audience === 'staff')) {
      expect(permitted(await call(route, headers)), `superadmin should reach ${route.name}`).toBe(true)
    }
  })

  it('refuses a department admin whose grant is the WRONG flag on the right module', async () => {
    await grant(app.pg, departmentAdmin.id, 'seo', { read: true })
    app.permissions.invalidate(departmentAdmin.id)
    const headers = await bearerFor(app, { accountId: departmentAdmin.id, accountKind: 'admin' })
    // seo.read now granted; seo.edit still is not.
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO edit'), headers)).toBe(403)
  })
})
