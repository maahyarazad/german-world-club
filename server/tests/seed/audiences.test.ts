import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import { bearerFor } from '../helpers/auth.ts'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import type { GwcApp } from '../../src/app.ts'
import type { SeededDatabase } from '../seed/helpers.ts'

/**
 * FR-003 and FR-012 — four principal kinds, and the walls between them.
 *
 * Before this feature two of the four kinds did not exist, so "a credential for
 * one audience cannot satisfy a route for another" was a property with two
 * cases in it. Twelve is the whole matrix: every kind against every other
 * kind's route.
 *
 * Driven against a **seeded** database rather than hand-made fixtures, because
 * the claim under test is that the seeded population is usable for exactly this
 * — someone signing in as the merchant in the credentials table and finding
 * they cannot see the partner's data.
 */

/** One route per audience: the cheapest thing each kind is entitled to. */
const ROUTES = Object.freeze({
  member: { method: 'GET', url: '/auth/me' },
  staff: { method: 'GET', url: '/auth/session' },
  merchant: { method: 'GET', url: '/merchant/organisation' },
  partner: { method: 'GET', url: '/partner/organisation' },
})

/** The `aud` claim each kind's token carries; staff sessions are `admin`. */
const TOKEN_KIND = Object.freeze({ member: 'member', staff: 'admin', merchant: 'merchant', partner: 'partner' })

describe.skipIf(!hasDatabase)('four audiences, twelve walls', () => {
  let db: SeededDatabase
  let app: GwcApp
  const accounts = {}

  beforeAll(async () => {
    db = await withSeededDatabase('gwc_seed_audiences')
    process.env.DATABASE_URL = db.url
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()

    const one = async (sql) => (await db.pool.query(sql)).rows[0]

    accounts.member = await one(`
      SELECT id FROM members
       WHERE status = 'active' AND email_confirmed_at IS NOT NULL
         AND password_hash LIKE '$argon2%'
       ORDER BY email LIMIT 1`)
    accounts.staff = await one(`
      SELECT id FROM admin_users WHERE is_active = true AND is_superadmin = true ORDER BY email LIMIT 1`)
    accounts.merchant = await one(`
      SELECT ou.id, ou.organisation_id FROM organisation_users ou
        JOIN organisations o ON o.id = ou.organisation_id
       WHERE o.kind = 'merchant' AND o.status = 'active' AND ou.status = 'active'
       ORDER BY ou.email LIMIT 1`)
    accounts.partner = await one(`
      SELECT ou.id, ou.organisation_id FROM organisation_users ou
        JOIN organisations o ON o.id = ou.organisation_id
       WHERE o.kind = 'partner' AND o.status = 'active' AND ou.status = 'active'
       ORDER BY ou.email LIMIT 1`)
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  })

  const call = async (kind, route) => {
    const headers = await bearerFor(app, { accountId: accounts[kind].id, accountKind: TOKEN_KIND[kind] })
    return app.inject({ method: route.method, url: route.url, headers })
  }

  it('seeded all four kinds — without which the matrix below is vacuous', () => {
    for (const kind of Object.keys(ROUTES)) {
      expect(accounts[kind], `the seed produced no usable ${kind}`).toBeTruthy()
    }
  })

  /**
   * The counter-assertion, and it comes first deliberately.
   *
   * Twelve refusals are also what a server that refuses everybody produces. The
   * four admissions are what make the twelve mean something.
   */
  it.each(Object.keys(ROUTES))('%s reaches its own route', async (kind) => {
    const response = await call(kind, ROUTES[kind])
    expect(response.statusCode, `${kind}: ${response.body}`).toBe(200)
  })

  const crossings = Object.keys(ROUTES).flatMap((caller) =>
    Object.keys(ROUTES).filter((k) => k !== caller).map((target) => [caller, target]))

  it('crosses exactly twelve boundaries', () => {
    expect(crossings).toHaveLength(12)
  })

  it.each(crossings)('a %s credential is refused at the %s route', async (caller, target) => {
    const response = await call(caller, ROUTES[target])
    // 403, not 401: the credential is valid and re-authenticating cannot help.
    // Telling the client to try again would be an invitation to loop.
    expect(response.statusCode, `${caller} → ${target}: ${response.body}`).toBe(403)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
  })
})

/**
 * FR-012 / SC-009 — scope, which the route table cannot express.
 *
 * Audience isolation stops a merchant at a partner route. It does nothing
 * whatsoever about one merchant reading another merchant's row, and that is the
 * failure this half exists to catch.
 */
describe.skipIf(!hasDatabase)('an organisation principal sees its own organisation and no other', () => {
  let db: SeededDatabase
  let app: GwcApp
  let principal
  let ownId
  let otherId

  beforeAll(async () => {
    db = await withSeededDatabase('gwc_seed_scope')
    process.env.DATABASE_URL = db.url
    app = await buildApp({ contentSource: createFixtureContentSource([]) })
    await app.ready()

    const { rows } = await db.pool.query(`
      SELECT ou.id, ou.organisation_id FROM organisation_users ou
        JOIN organisations o ON o.id = ou.organisation_id
       WHERE o.kind = 'merchant' AND o.status = 'active' AND ou.status = 'active'
       ORDER BY ou.email LIMIT 1`)
    principal = rows[0]
    ownId = principal.organisation_id

    const { rows: others } = await db.pool.query(
      `SELECT id FROM organisations WHERE kind = 'merchant' AND id <> $1 ORDER BY slug LIMIT 1`,
      [ownId],
    )
    otherId = others[0]?.id
  }, 180_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  })

  const get = async (url) => {
    const headers = await bearerFor(app, { accountId: principal.id, accountKind: 'merchant' })
    return app.inject({ method: 'GET', url, headers })
  }

  it('seeded more than one merchant — otherwise there is nothing to be refused from', () => {
    expect(otherId).toBeTruthy()
    expect(otherId).not.toBe(ownId)
  })

  it('reads its own organisation by id', async () => {
    const response = await get(`/merchant/organisations/${ownId}`)
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().id).toBe(ownId)
  })

  it("answers 404 for another merchant's organisation", async () => {
    const response = await get(`/merchant/organisations/${otherId}`)
    expect(response.statusCode).toBe(404)
  })

  /**
   * SC-009, stated precisely: the two answers are identical, not merely both
   * refusals.
   *
   * A 403 on a real id and a 404 on an invented one would confirm which
   * organisations exist — one merchant login would enumerate the club's
   * commercial partners by guessing uuids. Comparing the whole body catches the
   * subtler version, where the status matches and a `detail` says "not yours".
   */
  it("cannot be told apart from an organisation that does not exist", async () => {
    const real = await get(`/merchant/organisations/${otherId}`)
    const invented = await get(`/merchant/organisations/${randomUUID()}`)

    expect(real.statusCode).toBe(invented.statusCode)
    const strip = (body) => {
      // `requestId` is per-request by definition and is the one field that
      // legitimately differs; everything else must match byte for byte.
      // Two fields legitimately differ and neither discloses anything:
      // `requestId` is per-request by definition, and `instance` is the URL the
      // caller just typed. Everything a client could learn *from* must match.
      const { requestId, instance, ...rest } = JSON.parse(body)
      return rest
    }
    expect(strip(real.body)).toEqual(strip(invented.body))
  })

  it('records the probe, so an enumeration attempt is visible even though the answer is not', async () => {
    // The response is deliberately uninformative. That is a reason to write the
    // denial down, not a reason not to notice it.
    const before = await db.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'permission_denied' AND required_permission = 'organisation-scope'`,
    )
    await get(`/merchant/organisations/${otherId}`)
    const after = await db.pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'permission_denied' AND required_permission = 'organisation-scope'`,
    )
    expect(after.rows[0].n).toBeGreaterThan(before.rows[0].n)
  })
})
