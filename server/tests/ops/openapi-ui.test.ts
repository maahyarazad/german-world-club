import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../../src/app.ts'
import { loadEnv } from '../../src/config/env.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { buildAuthApp, createAdmin, createMember, grant, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * The docs UI (T206–T223) — gated, not public.
 *
 * `@fastify/swagger` itself is covered by the OpenAPI assertions in the matrix
 * and posture suites. What is new here is a *browsable* surface, and the whole
 * risk of a browsable surface is that it renders the entire shape of the admin
 * API to whoever can reach it. So every assertion below is about who cannot
 * reach it, and each carries a counter-assertion — a test that would pass
 * against a server that registered nothing at all is not a test.
 */

const DOCS = '/admin/docs'

/** Every route swagger-ui registers, as the router actually holds them. */
const docsRoutes = (app) => app.routePostures().filter((r) => r.url.startsWith(DOCS))

describe('the docs UI does not weaken the startup gate', () => {
  it('boots with the UI registered', async () => {
    const app = await buildApp()
    await expect(app.ready()).resolves.toBeTruthy()
    expect(docsRoutes(app).length).toBeGreaterThan(0)
    await app.close()
  })

  /**
   * The counter-assertion for the test above. Declaring the posture for
   * swagger-ui's routes is done with a scope-level `onRoute` hook, and the
   * cheapest way to get that hook to "work" would be to stop the gate
   * throwing. This proves it still throws for an ordinary undeclared route.
   */
  it('STILL FAILS STARTUP on an undeclared route — the exemption is scoped', async () => {
    const app = await buildApp()
    app.get('/undeclared-alongside-docs', async () => ({ ok: true }))
    await expect(app.ready()).rejects.toThrow(/no config\.auth declared/)
    await app.close().catch(() => {})
  })

  it('declares staff posture on EVERY docs route, including the static subtree', async () => {
    const app = await buildApp()
    await app.ready()
    const routes = docsRoutes(app)
    // Counter-assertion: a version of swagger-ui that renamed its routes must
    // not reduce this to a vacuous pass over an empty list.
    expect(routes.length).toBeGreaterThanOrEqual(6)
    for (const route of routes) {
      expect(route.auth, `${route.method} ${route.url}`).toEqual({
        audience: 'staff', module: 'settings', flag: 'read',
      })
    }
    // The bundle itself is the route `uiHooks` would have left unguarded.
    expect(routes.some((r) => r.url.includes('/static/'))).toBe(true)
    await app.close()
  })
})

describe('anonymous reaches no part of the docs', () => {
  let app
  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  it.each([
    ['the page', `${DOCS}`],
    ['the bundle', `${DOCS}/static/swagger-ui.css`],
    ['the initializer', `${DOCS}/static/swagger-initializer.js`],
    ['the document it renders', `${DOCS}/json`],
    ['the YAML copy', `${DOCS}/yaml`],
  ])('refuses %s', async (_name, url) => {
    const response = await app.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(401)
    /**
     * Counter-assertion, and the real point of this suite: a docs UI that
     * answers 200 with an HTML shell and only *then* fails to fetch its spec
     * has already published the surface's existence and its shape. The refusal
     * must be the documented problem+json, never a page.
     */
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
    expect(response.body).not.toMatch(/<html/i)
  })

  it('serves the same refusal as the document route it renders', async () => {
    const docs = await app.inject({ method: 'GET', url: DOCS })
    const json = await app.inject({ method: 'GET', url: '/admin/openapi.json' })
    expect(docs.statusCode).toBe(json.statusCode)
    expect(docs.json().type).toBe(json.json().type)
  })
})

describe('the docs carry the gated-surface headers (§10.1)', () => {
  let app
  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  it('is never indexed and never cached', async () => {
    const response = await app.inject({ method: 'GET', url: DOCS })
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow')
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('scopes its CSP to the docs subtree and leaves the global policy strict', async () => {
    const docs = await app.inject({ method: 'GET', url: DOCS })
    const publicRoute = await app.inject({ method: 'GET', url: '/robots.txt' })

    // swagger-ui's own policy still forbids inline script — the bundle
    // externalises everything, so no 'unsafe-inline' was needed to render it.
    expect(docs.headers['content-security-policy']).toContain("script-src 'self'")
    expect(docs.headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'")

    /**
     * Counter-assertion: the relaxation that lets swagger-ui style itself
     * (`style-src 'self' https:`) must not have leaked into the global policy.
     */
    expect(publicRoute.headers['content-security-policy']).not.toContain('validator.swagger.io')
    expect(publicRoute.headers['content-security-policy']).toContain("default-src 'self'")
  })
})

describe('the document the UI renders', () => {
  let app
  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  it('is OpenAPI 3.1 and describes the routes that exist', () => {
    const doc = app.swagger()
    expect(doc.openapi).toMatch(/^3\.1/)
    expect(Object.keys(doc.paths).length).toBeGreaterThan(10)
  })

  it('annotates a gated route and a public route differently', () => {
    const doc = app.swagger()
    const gated = doc.paths['/auth/staff/me']?.get
    const openRoute = doc.paths['/robots.txt']?.get

    expect(gated).toBeDefined()
    expect(gated.security).toEqual([{ bearer: [] }, { cookie: [] }])
    expect(gated.description).toMatch(/settings/)

    /**
     * Counter-assertion: if every operation were annotated identically the
     * assertion above would pass while telling a reader nothing. A public
     * route must carry the empty requirement, not the bearer one.
     */
    expect(openRoute).toBeDefined()
    expect(openRoute.security).toEqual([])
  })

  it('does not describe the docs UI as operations inside itself', () => {
    expect(Object.keys(app.swagger().paths).filter((p) => p.startsWith(DOCS))).toEqual([])
  })
})

describe.skipIf(!hasDatabase)('a staff member with settings.read can browse', () => {
  let app
  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterAll(async () => { await app.close() })

  it('renders the page for settings.read and refuses a member without it', async () => {
    const admin = await createAdmin(app.pg, { grants: { settings: { read: true } } })
    const staffAuth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
    const page = await app.inject({ method: 'GET', url: DOCS, headers: staffAuth })
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toMatch(/text\/html/)
    expect(page.body).toMatch(/swagger-ui/i)

    // The account-keyed bucket only runs once a principal exists, so this is
    // the first request that can carry limit headers at all.
    expect(page.headers['ratelimit-limit']).toBeDefined()

    /**
     * Counter-assertion: a member is authenticated but holds no staff module,
     * so the page must be refused as problem+json rather than rendered.
     */
    const member = await createMember(app.pg)
    const memberAuth = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    const refused = await app.inject({ method: 'GET', url: DOCS, headers: memberAuth })
    expect(refused.statusCode).toBe(403)
    expect(refused.headers['content-type']).toMatch(/application\/problem\+json/)
    expect(refused.body).not.toMatch(/<html/i)
  })

  it('refuses a staff member holding a different module', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    await grant(app.pg, admin.id, 'seo', { read: true })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
    const response = await app.inject({ method: 'GET', url: DOCS, headers: auth })
    expect(response.statusCode).toBe(403)
  })
})

/**
 * The development mount — public, and only in development.
 *
 * Every assertion here is paired with the same request against a non-
 * development build, because "the page renders" is not the property under
 * test: the property is that it renders *there and nowhere else*, and a test
 * that only proves the first half would pass against a server that published
 * its admin surface on the public origin.
 */
const DEV_DOCS = '/swagger-ui'

const buildIn = async (nodeEnv) => {
  const app = await buildApp({
    env: loadEnv({ ...process.env, NODE_ENV: nodeEnv }),
    contentSource: createFixtureContentSource([]),
  })
  await app.ready()
  return app
}

describe('the development docs mount', () => {
  let dev
  let prod
  beforeAll(async () => {
    dev = await buildIn('development')
    // Any environment that is not `development`. `test` rather than
    // `production` because the env schema refuses to load production without
    // the three preconditions server/README.md documents, and the branch under
    // test asks only whether the value is exactly 'development'.
    prod = await buildIn('test')
  })
  afterAll(async () => { await dev.close(); await prod.close() })

  it.each([
    ['the page', DEV_DOCS],
    ['the bundle', `${DEV_DOCS}/static/swagger-ui.css`],
    ['the initializer', `${DEV_DOCS}/static/swagger-initializer.js`],
    ['the document it renders', `${DEV_DOCS}/json`],
  ])('serves %s to an anonymous caller in development', async (_name, url) => {
    const response = await dev.inject({ method: 'GET', url })
    expect(response.statusCode).toBe(200)

    /**
     * The counter-assertion, and the only one that matters: the same
     * unauthenticated request outside development must not find a route at
     * all. 404, not 401 — the routes are never registered, so there is nothing
     * to authenticate against and nothing whose existence a refusal confirms.
     */
    const outside = await prod.inject({ method: 'GET', url })
    expect(outside.statusCode).toBe(404)
  })

  it('renders the actual UI, not an empty shell', async () => {
    const page = await dev.inject({ method: 'GET', url: DEV_DOCS })
    expect(page.headers['content-type']).toMatch(/text\/html/)
    expect(page.body).toMatch(/swagger-ui/i)

    // It must describe the same document the gated mount does — a dev UI
    // rendering a different or empty spec would be worse than none.
    const doc = await dev.inject({ method: 'GET', url: `${DEV_DOCS}/json` })
    expect(Object.keys(doc.json().paths).length).toBeGreaterThan(10)
  })

  /**
   * The assets' *bytes*, not their status code.
   *
   * A 200 is not evidence the file arrived. Wrapping @fastify/static's handler
   * — which returns undefined and streams the file on a later tick — in a
   * promise made Fastify's `wrap-thenable` answer `reply.send(undefined)` the
   * moment that promise settled, so every asset came back 200 with
   * `content-length: 0` and no content-type. swagger-ui's HTML rendered, its
   * bundle was empty, and the page was white. Only the length tells the two
   * apart, so the length is what is asserted.
   */
  it.each([
    ['the stylesheet', 'swagger-ui.css', /text\/css/],
    ['the bundle', 'swagger-ui-bundle.js', /javascript/],
    ['the standalone preset', 'swagger-ui-standalone-preset.js', /javascript/],
  ])('serves the bytes of %s, not an empty 200', async (_name, file, type) => {
    const response = await dev.inject({ method: 'GET', url: `${DEV_DOCS}/static/${file}` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(type)
    // The real files are hundreds of kilobytes; any plausible truncation or
    // substitution lands well under this.
    expect(response.rawPayload.length).toBeGreaterThan(1000)
  })

  it('declares public posture on EVERY route it registers, static subtree included', async () => {
    const routes = dev.routePostures().filter((r) => r.url.startsWith(DEV_DOCS))
    expect(routes.length).toBeGreaterThanOrEqual(6)
    for (const route of routes) {
      expect(route.auth, `${route.method} ${route.url}`).toEqual({ audience: 'public' })
    }
    expect(routes.some((r) => r.url.includes('/static/'))).toBe(true)

    // Counter-assertion: nothing was registered outside development to declare.
    expect(prod.routePostures().filter((r) => r.url.startsWith(DEV_DOCS))).toEqual([])
  })

  it('is rate-limited and never indexed even though it is public', async () => {
    const page = await dev.inject({ method: 'GET', url: DEV_DOCS })
    // IP-keyed, so unlike the gated mount the limiter runs with no principal.
    expect(page.headers['ratelimit-limit']).toBeDefined()
    expect(page.headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  it('leaves the gated mount gated in development too', async () => {
    const response = await dev.inject({ method: 'GET', url: DOCS })
    expect(response.statusCode).toBe(401)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
  })

  it('does not describe itself as operations inside the document', () => {
    expect(Object.keys(dev.swagger().paths).filter((p) => p.startsWith(DEV_DOCS))).toEqual([])
  })
})
