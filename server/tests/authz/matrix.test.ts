import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MEMBER_PERMISSIONS } from '@gwc/contracts/permissions'
import { randomUUID } from 'node:crypto'
import { buildAuthApp, createMember, createAdmin, grant, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { MODULES, FLAGS } from '@gwc/contracts/permissions'
import { INSTITUTIONAL_SLUGS } from '../../src/modules/public/routes.ts'
import type { GwcApp } from '../../src/app.ts'

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
let app: GwcApp
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
  // Public on purpose, and the only public route that costs money per call.
  // Its compensating controls (a non-fail-open IP bucket, a bounded prompt, a
  // server-side prompt template) are asserted in tests/rag/ask.test.ts.
  { name: 'rag ask', url: '/rag/ask', method: 'POST', audience: 'public' },
  { name: 'landing', url: '/', method: 'GET', audience: 'public' },
  // The English half of the landing pair. Public and indexed, like its twin.
  { name: 'landing (en)', url: '/en', method: 'GET', audience: 'public' },
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
  // Public deliberately: the console needs a token after a page reload, before
  // it knows whether it is signed in. The token is worthless without the secret
  // cookie the same response sets, and a cross-site page can send that cookie
  // but cannot read it — which is the whole point of a double submit.
  { name: 'csrf token', url: '/auth/csrf', method: 'GET', audience: 'public' },
  { name: 'member profile', url: '/auth/me', method: 'GET', audience: 'member' },
  { name: 'member sign-out', url: '/auth/sign-out', method: 'POST', audience: 'member' },
  { name: 'staff profile', url: '/auth/staff/me', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  // The capability snapshot the console boots from. Staff-gated, but with no
  // module: knowing what you may do is not a privilege on the settings module.
  // The `anyStaff` exemption is affirmative and the posture gate refuses a
  // staff route that merely omits module and flag — see 11-rbac.js.
  { name: 'capability snapshot', url: '/auth/session', method: 'GET', audience: 'staff', anyStaff: true },
  // anyStaff: ending your own session cannot depend on a module grant.
  { name: 'staff sign-out', url: '/auth/staff/sign-out', method: 'POST', audience: 'staff', anyStaff: true },
  // The organisation principals' snapshot and sign-out, one pair per kind:
  // `/auth/session` is staff-audience and cannot also be theirs.
  { name: 'merchant capability snapshot', url: '/auth/merchant/session', method: 'GET', audience: 'merchant' },
  { name: 'merchant sign-out', url: '/auth/merchant/sign-out', method: 'POST', audience: 'merchant' },
  { name: 'partner capability snapshot', url: '/auth/partner/session', method: 'GET', audience: 'partner' },
  { name: 'partner sign-out', url: '/auth/partner/sign-out', method: 'POST', audience: 'partner' },
  // Media delivery is public — a crawler must be able to fetch the images a
  // partner page references — while ingest and management are member-gated.
  { name: 'media variant', url: '/media/:checksum/:variant.:ext', probe: '/media/deadbeef/medium.webp', method: 'GET', audience: 'public' },
  { name: 'media upload', url: '/media', method: 'POST', audience: 'member' },
  { name: 'media read', url: '/media/:id', probe: `/media/${randomUUID()}`, method: 'GET', audience: 'member' },
  { name: 'media delete', url: '/media/:id', probe: `/media/${randomUUID()}`, method: 'DELETE', audience: 'member' },
  // Push: devices belong to the member holding them; broadcasting to every
  // member's phone is the `mass_messages` privilege by another transport.
  // --- Marketplace (008) -----------------------------------------------------
  // Members only. Organisations sell through `offers` (§5) and staff do not
  // sell at all — moderating a market you trade in is a conflict of interest.
  // Posting additionally requires the per-member `marketplace_post` flag.
  { name: 'marketplace create listing', url: '/marketplace/listings', method: 'POST', audience: 'member', requires: 'marketplace_post' },
  // No `requires` on the terms routes: a member must be able to read and
  // accept the terms before they can hold the flag that posting needs.
  { name: 'marketplace read terms', url: '/marketplace/terms', method: 'GET', audience: 'member' },
  { name: 'marketplace accept terms', url: '/marketplace/terms/accept', method: 'POST', audience: 'member' },
  { name: 'marketplace categories', url: '/marketplace/categories', method: 'GET', audience: 'member' },
  // No `requires` on browsing: reading the market is not gated on being able
  // to sell in it. Only creating a listing needs the per-member flag.
  { name: 'marketplace browse', url: '/marketplace/listings', method: 'GET', audience: 'member' },
  { name: 'marketplace read listing', url: '/marketplace/listings/:id', probe: `/marketplace/listings/${randomUUID()}`, method: 'GET', audience: 'member' },
  // Attaching media to a listing is part of posting one, so it carries the
  // same flag as the create route.
  { name: 'marketplace attach media', url: '/marketplace/listings/:id/media', probe: `/marketplace/listings/${randomUUID()}/media`, method: 'POST', audience: 'member', requires: 'marketplace_post' },
  { name: 'marketplace detach media', url: '/marketplace/listings/:id/media/:assetId', probe: `/marketplace/listings/${randomUUID()}/media/${randomUUID()}`, method: 'DELETE', audience: 'member', requires: 'marketplace_post' },
  // No `requires` on enquiring: contacting a seller is not selling, and gating
  // it on the posting flag would mean only sellers could buy.
  { name: 'marketplace enquire', url: '/marketplace/listings/:id/inquire', probe: `/marketplace/listings/${randomUUID()}/inquire`, method: 'POST', audience: 'member' },
  // No `requires` on any of the three below: owning what you already posted is
  // not a second privilege, and a member whose posting flag was later revoked
  // must still be able to withdraw or edit what they posted while they held it.
  { name: 'marketplace edit listing', url: '/marketplace/listings/:id', probe: `/marketplace/listings/${randomUUID()}`, method: 'PATCH', audience: 'member' },
  { name: 'marketplace set listing state', url: '/marketplace/listings/:id/state', probe: `/marketplace/listings/${randomUUID()}/state`, method: 'POST', audience: 'member' },
  { name: 'marketplace mine', url: '/marketplace/mine', method: 'GET', audience: 'member' },
  // The one member-module route that IS public, deliberately (008 US7): counts
  // only, never a listing (FR-034/035). posture.test.ts excludes it from the
  // "every marketplace route needs a bearer" sweep for the same reason.
  { name: 'marketplace summary', url: '/marketplace/summary', method: 'GET', audience: 'public' },
  { name: 'marketplace discovery page', url: '/marktplatz', method: 'GET', audience: 'public' },
  { name: 'marketplace report listing', url: '/marketplace/listings/:id/report', probe: `/marketplace/listings/${randomUUID()}/report`, method: 'POST', audience: 'member' },

  // --- Marketplace moderation (008 US4) --------------------------------------
  // Gated on the EXISTING marketplace_moderation module — this feature adds no
  // permission, it fills a hole the matrix already has.
  { name: 'marketplace moderation reports', url: '/admin/marketplace/reports', method: 'GET', audience: 'staff', module: 'marketplace_moderation', flag: 'read' },
  { name: 'marketplace moderation listing', url: '/admin/marketplace/listings/:id', probe: `/admin/marketplace/listings/${randomUUID()}`, method: 'GET', audience: 'staff', module: 'marketplace_moderation', flag: 'read' },
  { name: 'marketplace moderation hide', url: '/admin/marketplace/listings/:id/hide', probe: `/admin/marketplace/listings/${randomUUID()}/hide`, method: 'POST', audience: 'staff', module: 'marketplace_moderation', flag: 'status' },
  { name: 'marketplace moderation restore', url: '/admin/marketplace/listings/:id/restore', probe: `/admin/marketplace/listings/${randomUUID()}/restore`, method: 'POST', audience: 'staff', module: 'marketplace_moderation', flag: 'status' },
  { name: 'marketplace moderation remove', url: '/admin/marketplace/listings/:id', probe: `/admin/marketplace/listings/${randomUUID()}`, method: 'DELETE', audience: 'staff', module: 'marketplace_moderation', flag: 'delete' },
  { name: 'marketplace moderation resolve report', url: '/admin/marketplace/reports/:id/resolve', probe: `/admin/marketplace/reports/${randomUUID()}/resolve`, method: 'POST', audience: 'staff', module: 'marketplace_moderation', flag: 'status' },

  // --- Messaging (008 US5) ---------------------------------------------------
  // Member-audience and no flag: replying to someone who contacted you is not
  // a privilege a member has to be granted. Participation is a per-row rule and
  // is enforced in the application layer, where it answers 404 rather than 403.
  { name: 'messaging inbox', url: '/messages/conversations', method: 'GET', audience: 'member' },
  { name: 'messaging read', url: '/messages/conversations/:id', probe: `/messages/conversations/${randomUUID()}`, method: 'GET', audience: 'member' },
  { name: 'messaging reply', url: '/messages/conversations/:id/messages', probe: `/messages/conversations/${randomUUID()}/messages`, method: 'POST', audience: 'member' },

  { name: 'push register device', url: '/push/devices', method: 'POST', audience: 'member' },
  { name: 'push list devices', url: '/push/devices', method: 'GET', audience: 'member' },
  { name: 'push delete device', url: '/push/devices/:id', probe: `/push/devices/${randomUUID()}`, method: 'DELETE', audience: 'member' },
  { name: 'push broadcast', url: '/push/campaigns', method: 'POST', audience: 'staff', module: 'mass_messages', flag: 'write' },
  { name: 'push preview', url: '/push/campaigns/preview', method: 'POST', audience: 'staff', module: 'mass_messages', flag: 'write' },
  { name: 'push history', url: '/push/campaigns', method: 'GET', audience: 'staff', module: 'mass_messages', flag: 'read' },
  { name: 'push test list', url: '/push/test-recipients', method: 'GET', audience: 'staff', module: 'mass_messages', flag: 'read' },
  { name: 'push test add', url: '/push/test-recipients', method: 'POST', audience: 'staff', module: 'mass_messages', flag: 'edit' },
  { name: 'push test remove', url: '/push/test-recipients/:id', probe: `/push/test-recipients/${randomUUID()}`, method: 'DELETE', audience: 'staff', module: 'mass_messages', flag: 'edit' },
  // The generated OpenAPI document. Staff-gated rather than public: the shape
  // of the admin API is not something an invite-only club publishes.
  { name: 'openapi document', url: '/admin/openapi.json', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  // The docs UI renders that same document, so it carries the same posture —
  // including the static bundle, which is the route @fastify/swagger-ui's own
  // `uiHooks` would have left unauthenticated (see 15-openapi.js).
  { name: 'docs page', url: '/admin/docs/', probe: '/admin/docs/', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'docs index redirect', url: '/admin/docs/static/index.html', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'docs initializer', url: '/admin/docs/static/swagger-initializer.js', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'docs document', url: '/admin/docs/json', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'docs document (yaml)', url: '/admin/docs/yaml', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  { name: 'docs bundle', url: '/admin/docs/static/*', probe: '/admin/docs/static/swagger-ui.css', method: 'GET', audience: 'staff', module: 'settings', flag: 'read' },
  // Organisation principals. Two audiences that are neither members nor staff:
  // a merchant token is refused at a partner route at verification time, before
  // any handler, which is why these are four routes rather than two with a
  // branch inside. The `:id` pair carries the object guard — see
  // tests/seed/audiences.test.js for the scoping half, which a route table
  // cannot express.
  { name: 'merchant organisation', url: '/merchant/organisation', method: 'GET', audience: 'merchant' },
  { name: 'merchant organisation by id', url: '/merchant/organisations/:id', probe: `/merchant/organisations/${randomUUID()}`, method: 'GET', audience: 'merchant' },
  { name: 'partner organisation', url: '/partner/organisation', method: 'GET', audience: 'partner' },
  { name: 'partner organisation by id', url: '/partner/organisations/:id', probe: `/partner/organisations/${randomUUID()}`, method: 'GET', audience: 'partner' },
  { name: 'SEO read', url: '/admin/seo/:recordType/:recordId', method: 'GET', audience: 'staff', module: 'seo', flag: 'read' },
  { name: 'SEO edit', url: '/admin/seo/:recordType/:recordId', method: 'PATCH', audience: 'staff', module: 'seo', flag: 'edit' },
  // The console's SPA shell. Public because it IS public: an empty application
  // shell with no member content, no capability data and no principal in it.
  // The surface it opens is gated — modules/seo/surfaces.js declares /konsole gated and
  // never indexed — but the shell itself discloses nothing, which is what
  // tests/console/spa-fallback.test.js asserts directly.
  { name: 'console shell', url: '/konsole', method: 'GET', audience: 'public' },
  { name: 'console deep link', url: '/konsole/*', probe: '/konsole/admin/seo', method: 'GET', audience: 'public' },
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
        if (route.anyStaff) {
          // A module-less staff route must say so affirmatively and must not
          // also carry a module — two postures on one route would leave no way
          // to tell which governs.
          expect(found.auth.anyStaff).toBe(true)
          expect(found.auth.module).toBeUndefined()
          expect(found.auth.flag).toBeUndefined()
        } else {
          expect(found.auth.module).toBe(route.module)
          expect(found.auth.flag).toBe(route.flag)
        }
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
      // @fastify/static registers one route per file in the static root, and
      // which files exist changes with every client build. Their posture is
      // declared once for the whole scope (see app.js), so they are excluded
      // by that marker rather than by guessing at file extensions.
      .filter((r) => !r.staticFile)
      .flatMap((r) => [].concat(r.method).map((m) => `${m} ${r.url}`))
      // HEAD is registered automatically alongside every GET.
      .filter((k) => !k.startsWith('HEAD '))
      .filter((k) => !covered.has(k))

    expect(uncovered).toEqual([])
  })

  it('declares only known modules and flags on staff routes', () => {
    for (const route of app.routePostures()) {
      if (route.auth.audience !== 'staff') continue
      // A module-less staff route is permitted ONLY against an affirmative
      // `anyStaff: true`. Silence is still a declaration error, so this branch
      // widens what a route may say without widening what it may leave unsaid.
      if (route.auth.anyStaff === true) {
        expect(route.auth.module, `${route.method} ${route.url}`).toBeUndefined()
        expect(route.auth.flag, `${route.method} ${route.url}`).toBeUndefined()
        continue
      }
      expect(MODULES).toContain(route.auth.module)
      expect(FLAGS).toContain(route.auth.flag)
    }
  })

  /**
   * The exemption must stay rare and must stay deliberate.
   *
   * Two routes genuinely have no module, and both are about the caller's own
   * session rather than about any part of the system: reading what you may do,
   * and stopping being signed in. Gating either on a module means a staff
   * member can be locked out of their own session by a grant somebody else
   * controls.
   *
   * This list is written out in full so growing it is a decision, not a drift.
   * If a third route appears here, `anyStaff` has become the easy way past the
   * gate rather than the narrow answer to two specific problems.
   */
  it('uses the anyStaff exemption on exactly two routes, both about the caller\'s own session', () => {
    const exempt = app
      .routePostures()
      .filter((r) => r.auth.anyStaff === true)
      .flatMap((r) => [].concat(r.method).map((m) => `${m} ${r.url}`))
      .filter((k) => !k.startsWith('HEAD '))
      .sort()

    expect(exempt).toEqual(['GET /auth/session', 'POST /auth/staff/sign-out'])
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
  let member: Record<string, unknown>
  /** A member holding every per-member flag, for the `requires` rows. */
  let flaggedMember: Record<string, unknown>
  let departmentAdmin
  let superadmin

  beforeAll(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
    flaggedMember = await createMember(app.pg, {
      permissions: Object.fromEntries(MEMBER_PERMISSIONS.map((p) => [p, true])),
    })
    departmentAdmin = await createAdmin(app.pg, { grants: { settings: { read: true } } })
    superadmin = await createAdmin(app.pg, { isSuperadmin: true })
    app.permissions.invalidateAll()
  })

  const call = async (route, headers) => {
    const url = (route.probe ?? route.url).replace(':recordType', 'partner').replace(':recordId', randomUUID())
    const response = await app.inject({ method: route.method, url, headers, payload: route.method === 'POST' || route.method === 'PATCH' ? {} : undefined })
    return response.statusCode
  }

  /**
   * "Reached the handler", not "succeeded".
   *
   * This suite is about the authorization matrix, so anything that is the
   * handler's own answer counts as reached: 404 for a probe id that does not
   * exist, 409/422 for a business rule, 406/415 for a content type the route
   * declines (the upload route wants multipart and these probes send JSON).
   * Only 401 and 403 mean the principal was turned away, which is what the
   * matrix is actually asserting about.
   */
  const permitted = (status) => ![401, 403].includes(status) && status < 500

  /**
   * A fresh credential per probe.
   *
   * Some route classes in the sweep are destructive to the credential itself —
   * sign-out revokes the session — so reusing one bearer across the loop would
   * make every route after it fail on a revoked session rather than on its own
   * posture. Re-minting keeps each row of the matrix an independent assertion.
   */
  const sweep = async (account, routes, assert) => {
    for (const route of routes) {
      const headers = await bearerFor(app, account)
      await assert(route, await call(route, headers))
    }
  }

  it('admits a member to member routes and refuses every staff route', async () => {
    const account = { accountId: member.id, accountKind: 'member' }
    // Only the rows with no per-member flag. A route declaring `requires` has
    // a SECOND gate, and asserting a plain member reaches it would assert the
    // opposite of what §7's permission flag is for.
    const ungated = ROUTE_CLASSES.filter((r) => r.audience === 'member' && !r.requires)
    await sweep(account, ungated, (route, status) => {
      expect(permitted(status), `member should reach ${route.name}`).toBe(true)
    })
    await sweep(account, ROUTE_CLASSES.filter((r) => r.audience === 'staff'), (route, status) => {
      expect(status, `member must not reach ${route.name}`).toBe(403)
    })
  })

  it('refuses a member the routes gated on a per-member flag they lack', async () => {
    // §7's marketplace_post is the first of these. A member without it must be
    // refused by the API, not merely shown no button.
    const gated = ROUTE_CLASSES.filter((r) => r.audience === 'member' && r.requires)
    expect(gated.length, 'no flag-gated member route — this sweep proves nothing').toBeGreaterThan(0)

    await sweep({ accountId: member.id, accountKind: 'member' }, gated, (route, status) => {
      expect(status, `member without '${route.requires}' must not reach ${route.name}`).toBe(403)
    })
  })

  it('admits a member who HOLDS the flag — the counter-assertion', async () => {
    // Without this the sweep above would pass against a route that refused
    // every member, flag or not.
    const gated = ROUTE_CLASSES.filter((r) => r.audience === 'member' && r.requires)
    await sweep({ accountId: flaggedMember.id, accountKind: 'member' }, gated, (route, status) => {
      expect(status, `member holding '${route.requires}' should reach ${route.name}`).not.toBe(403)
    })
  })

  it('admits a department admin only where the module flag is granted', async () => {
    const headers = await bearerFor(app, { accountId: departmentAdmin.id, accountKind: 'admin' })
    // settings.read was granted; seo.* was not — absence is denial.
    expect(permitted(await call(ROUTE_CLASSES.find((r) => r.name === 'staff profile'), headers))).toBe(true)
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO read'), headers)).toBe(403)
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO edit'), headers)).toBe(403)
  })

  it('admits a superadmin everywhere, with no module row at all (FR-008)', async () => {
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM admin_permissions WHERE admin_user_id = $1', [superadmin.id])
    expect(rows[0].n).toBe(0)
    const account = { accountId: superadmin.id, accountKind: 'admin' }
    await sweep(account, ROUTE_CLASSES.filter((r) => r.audience === 'staff'), (route, status) => {
      expect(permitted(status), `superadmin should reach ${route.name}`).toBe(true)
    })
  })

  it('refuses a department admin whose grant is the WRONG flag on the right module', async () => {
    await grant(app.pg, departmentAdmin.id, 'seo', { read: true })
    app.permissions.invalidate(departmentAdmin.id)
    const headers = await bearerFor(app, { accountId: departmentAdmin.id, accountKind: 'admin' })
    // seo.read now granted; seo.edit still is not.
    expect(await call(ROUTE_CLASSES.find((r) => r.name === 'SEO edit'), headers)).toBe(403)
  })
})
