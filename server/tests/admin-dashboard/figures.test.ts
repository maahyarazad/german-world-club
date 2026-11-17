import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { DASHBOARD_FIGURES } from '@gwc/contracts/admin'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, bearerFor, createAdmin, createMember, resetAuthTables } from '../helpers/auth.ts'
import { seedListing, poster } from '../marketplace/helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import { computeFigures } from '../../src/modules/admin-dashboard/application/figures.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 028, US1 — the superadmin dashboard figures.
 *
 * A known population is inserted directly and every figure is compared with what
 * it should be. The population includes the near-misses each predicate has to
 * exclude (an applicant who is "active" by status, a suspended merchant, a draft
 * listing, a 40-day-old request, a dismissed report, a past event, an inactive
 * staff account), so a count that ignored its predicate fails here.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const figuresOf = (body: { figures: Array<{ key: string; value: number | null }> }) =>
  Object.fromEntries(body.figures.map((f) => [f.key, f.value]))

describe.skipIf(!hasDatabase)('GET /admin/dashboard/figures', () => {
  let superadmin: { id: string }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    await app.pg.query('TRUNCATE organisations, events RESTART IDENTITY CASCADE')
    superadmin = await createAdmin(app.pg, { isSuperadmin: true })
  })

  async function populate() {
    // Members. Status alone is not "active member": an applicant has status active too.
    for (let i = 0; i < 3; i += 1) await createMember(app.pg)
    const approved = await createMember(app.pg)
    const waiting = await createMember(app.pg)
    const unsubmitted = await createMember(app.pg)
    for (const status of ['locked', 'inactive', 'ended']) await createMember(app.pg, { status })
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at) VALUES
         ($1, 'd1', 'approved', now(), now()), ($2, 'd2', 'pending', now(), NULL), ($3, 'd3', 'pending', NULL, NULL)`,
      [approved.id, waiting.id, unsubmitted.id],
    )

    // Organisations.
    for (const [kind, status] of [['merchant', 'active'], ['merchant', 'active'], ['merchant', 'suspended'], ['partner', 'active'], ['partner', 'pending']]) {
      await app.pg.query(
        `INSERT INTO organisations (kind, legal_name, slug, status) VALUES ($1, $2, $3, $4)`,
        [kind, `Org ${randomUUID()}`, `org-${randomUUID()}`, status],
      )
    }

    // Listings, requests about them, and reports.
    const owner = await poster(app)
    const listings: string[] = []
    for (let i = 0; i < 3; i += 1) listings.push(await seedListing(app.pg, { ownerId: owner.id, state: 'active' }))
    await seedListing(app.pg, { ownerId: owner.id, state: 'draft' })
    await app.pg.query(
      `INSERT INTO conversations (subject_type, created_at) VALUES
         ('listing', now()), ('listing', now() - interval '5 days'), ('listing', now() - interval '40 days'), ('event', now())`,
    )
    const reporterA = await createMember(app.pg)
    const reporterB = await createMember(app.pg)
    await app.pg.query(
      `INSERT INTO marketplace_reports (listing_id, reporter_id, reason, state) VALUES ($1, $2, 'spam', 'open'), ($1, $3, 'spam', 'dismissed')`,
      [listings[0], reporterA.id, reporterB.id],
    )
    const { rows: post } = await app.pg.query(`INSERT INTO thread_posts (author_id, body) VALUES ($1, 'hello') RETURNING id`, [owner.id])
    await app.pg.query(
      `INSERT INTO thread_reports (post_id, reporter_id, reason, state, resolved_at) VALUES
         ($1, $2, 'abuse', 'open', NULL), ($1, $3, 'abuse', 'dismissed', now())`,
      [post[0].id, reporterA.id, reporterB.id],
    )

    // Events and staff.
    for (const interval of ['10 days', '30 days', '-10 days']) {
      await app.pg.query(
        `INSERT INTO events (slug, title, starts_at, capacity) VALUES ($1, 'E', now() + $2::interval, 50)`,
        [`ev-${randomUUID()}`, interval],
      )
    }
    await createAdmin(app.pg)
    await createAdmin(app.pg)
    await createAdmin(app.pg, { isActive: false })
  }

  it('returns every figure, in order, each equal to the records it describes', async () => {
    await populate()
    const headers = await bearerFor(app, { accountId: superadmin.id, accountKind: 'admin' })
    const response = await app.inject({ method: 'GET', url: '/admin/dashboard/figures', headers: { authorization: headers.authorization } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const body = response.json()
    expect(body.figures.map((f: { key: string }) => f.key)).toEqual([...DASHBOARD_FIGURES])
    expect(figuresOf(body)).toEqual({
      // 3 plain + 1 approved + the listing owner + two reporters = 7. The two pending
      // applicants (status active, application not approved), and the locked, inactive
      // and ended members are not "active members".
      activeMembers: 7,
      waitingApplications: 1,
      activeMerchants: 2,
      activePartners: 1,
      liveListings: 3,
      listingRequests: 2,
      openReports: 2,
      upcomingEvents: 2,
      activeStaff: 3,
    })
    expect(new Date(body.asOf).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('refuses a staff member who is not a superadmin, even holding every flag on admins', async () => {
    const staff = await createAdmin(app.pg, { grants: { admins: true } })
    const headers = await bearerFor(app, { accountId: staff.id, accountKind: 'admin' })
    const response = await app.inject({ method: 'GET', url: '/admin/dashboard/figures', headers: { authorization: headers.authorization } })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.CANNOT_MANAGE_ADMIN.type)
    // ...and a staff member with no grant on the module is refused by the module gate, not by the handler.
    const bare = await createAdmin(app.pg)
    const bareHeaders = await bearerFor(app, { accountId: bare.id, accountKind: 'admin' })
    expect((await app.inject({ method: 'GET', url: '/admin/dashboard/figures', headers: { authorization: bareHeaders.authorization } })).statusCode).toBe(403)
  })

  it('refuses a member and an unauthenticated caller', async () => {
    const member = await createMember(app.pg)
    const headers = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    expect((await app.inject({ method: 'GET', url: '/admin/dashboard/figures', headers: { authorization: headers.authorization } })).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'GET', url: '/admin/dashboard/figures' })).statusCode).toBe(401)
  })

  it('reports a figure it cannot compute as null while the others are numbers', async () => {
    await populate()
    // A pool whose queries touching marketplace_reports reject: that one figure fails.
    const flaky = {
      query: (sql: string, params?: unknown[]) =>
        /marketplace_reports/.test(sql) ? Promise.reject(new Error('boom')) : app.pg.query(sql, params),
    }
    const { figures } = await computeFigures(flaky as never, { log: () => undefined })
    const byKey = Object.fromEntries(figures.map((f) => [f.key, f.value]))
    expect(byKey.openReports).toBeNull()
    for (const key of DASHBOARD_FIGURES.filter((k) => k !== 'openReports')) {
      expect(typeof byKey[key], key).toBe('number')
    }
  })
})
