import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, createAdmin, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Only members sell (FR-038, SC-016).
 *
 * §5 is emphatic that a merchant is not a member and that a corporate
 * partnership is expressly not a membership. Organisations already have a
 * selling channel — `offers` (015_merchant_domain.sql) — which carries the
 * benefit, the validity window, the remaining count, the redemption code and
 * the terminal PIN. Giving them a second one with different semantics is what
 * this test exists to prevent.
 *
 * **Staff do not sell.** A staff member holding `marketplace_moderation` who
 * also lists items is moderating a market they trade in.
 *
 * Both halves of the mechanism are asserted: the route's audience is `member`,
 * and `marketplace_post` is a member-only flag.
 */

const TERMS = 'v1'

describe.skipIf(!hasDatabase)('who may create a listing', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await app.pg.query('TRUNCATE marketplace_listings, marketplace_terms_acceptances CASCADE')
    await resetAuthTables(app.pg)
  })

  const listing = {
    category: 'general',
    mode: 'offer',
    title: 'A perfectly ordinary listing',
    body: 'Long enough to pass the body length constraint without trouble.',
    details: { kind: 'product' },
    termsVersion: TERMS,
  }

  const post = (headers: Record<string, string>) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers, payload: listing })

  // ---- The counter-assertion, first --------------------------------------
  //
  // Without it every case below would pass against a route that refused
  // everybody, which is the failure mode an audience test is most prone to.

  it('a member holding marketplace_post CAN create one', async () => {
    const row = await createMember(app.pg, { permissions: { marketplace_post: true } })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [row.id, TERMS],
    )
    const headers = await bearerFor(app, { accountId: row.id, accountKind: 'member' })

    expect((await post(headers)).statusCode).toBe(201)
  })

  // ---- And now the refusals ----------------------------------------------

  it('refuses a STAFF principal — moderating a market you trade in', async () => {
    const admin = await createAdmin(app.pg, { grants: { marketplace_moderation: true } })
    const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const response = await post(headers)
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
    expect(response.statusCode).toBeLessThan(404)
  })

  it('refuses an unauthenticated caller', async () => {
    const response = await app.inject({
      method: 'POST', url: '/marketplace/listings', payload: listing,
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses a member WITHOUT the flag even with terms accepted', async () => {
    // The flag and the audience are two separate gates, and this pins the
    // first one independently of the second.
    const row = await createMember(app.pg, { permissions: {} })
    await app.pg.query(
      'INSERT INTO marketplace_terms_acceptances (member_id, version) VALUES ($1, $2)',
      [row.id, TERMS],
    )
    const headers = await bearerFor(app, { accountId: row.id, accountKind: 'member' })

    const response = await post(headers)
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toMatch(/permission-required/)
  })

  it('declares audience `member` on the posting route — the mechanism, not the effect', async () => {
    // Asserting the declaration as well as the behaviour: the behaviour could
    // be right for the wrong reason, and the posture is what the boot gate and
    // the audit trail read.
    // `routePostures` is a function returning the route table, not a Map. The
    // earlier `?.get?.()` form here read as an assertion but resolved to
    // undefined, so the block never ran and this test passed against anything.
    const posture = app.routePostures()
      .find((r) => r.url === '/marketplace/listings' && r.method === 'POST')

    expect(posture, 'the posting route is not in the route table').toBeTruthy()
    expect(posture?.auth.audience).toBe('member')
    expect(posture?.auth.requires).toBe('marketplace_post')
  })
})
