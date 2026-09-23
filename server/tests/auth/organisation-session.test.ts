import { randomUUID } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { hasDatabase } from '../helpers/db.ts'
import { buildAuthApp, bearerFor } from '../helpers/auth.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The organisation principals' capability snapshot and sign-out.
 *
 * The defect this pins: a merchant signed in successfully and then had no
 * capability route at all — `/auth/session` is staff-audience — so the
 * console rendered "permissions could not be loaded" on the member area.
 * Separately, the per-request gate refused `pending` organisations that
 * sign-in had just admitted, so a merchant being onboarded was locked out of
 * every request after sign-in, sign-out included.
 */
describe.skipIf(!hasDatabase)('organisation session', () => {
  let app: GwcApp
  const run = randomUUID().slice(0, 8)
  let made = 0

  /** Organisations refuse DELETE by trigger, so each run makes its own. */
  async function organisationUser(kind: 'merchant' | 'partner', status: string) {
    // Two tests may want the same kind and status; slugs and emails are unique.
    const tag = `${run}-${(made += 1)}`
    const { rows: [org] } = await app.pg.query(
      `INSERT INTO organisations (kind, legal_name, slug, status, location_count, employee_count)
       VALUES ($1, $2, $3, $4::organisation_status, $5, $6) RETURNING id`,
      [kind, `Test ${kind} ${status} ${tag}`, `test-${kind}-${status}-${tag}`, status,
        kind === 'merchant' ? 1 : null, kind === 'partner' ? 10 : null],
    )
    const { rows: [user] } = await app.pg.query(
      `INSERT INTO organisation_users (organisation_id, email, role, status, display_name)
       VALUES ($1, $2, 'owner', 'active', 'Test Owner') RETURNING id`,
      [org.id, `owner-${kind}-${status}-${tag}@test.invalid`],
    )
    return { organisationId: org.id as string, userId: user.id as string }
  }

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app?.close() })

  it('answers a merchant with the organisation snapshot the contract describes', async () => {
    const { organisationId, userId } = await organisationUser('merchant', 'active')
    const { authorization } = await bearerFor(app, { accountId: userId, accountKind: 'merchant' })

    const response = await app.inject({ method: 'GET', url: '/auth/merchant/session', headers: { authorization } })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toMatch(/no-store/)
    expect(response.json()).toEqual({
      kind: 'merchant',
      id: userId,
      displayName: 'Test Owner',
      organisationId,
      organisationName: expect.stringMatching(/^Test merchant active /),
      organisationStatus: 'active',
      role: 'owner',
      // No module matrix: an organisation principal must never be handed the
      // Admin Panel's list of servable modules.
      available: [],
    })
  })

  it('admits a pending organisation, as sign-in does', async () => {
    const { userId } = await organisationUser('merchant', 'pending')
    const { authorization } = await bearerFor(app, { accountId: userId, accountKind: 'merchant' })

    const response = await app.inject({ method: 'GET', url: '/auth/merchant/session', headers: { authorization } })
    expect(response.statusCode).toBe(200)
    expect(response.json().organisationStatus).toBe('pending')
  })

  it('still refuses a suspended organisation', async () => {
    // Counter-assertion: without it, "admit pending" passes against a gate
    // that admits everything.
    const { userId } = await organisationUser('merchant', 'suspended')
    const { authorization } = await bearerFor(app, { accountId: userId, accountKind: 'merchant' })

    const response = await app.inject({ method: 'GET', url: '/auth/merchant/session', headers: { authorization } })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.ACCOUNT_INACTIVE.type)
  })

  it('keeps the audiences apart', async () => {
    const { userId } = await organisationUser('partner', 'active')
    const { authorization } = await bearerFor(app, { accountId: userId, accountKind: 'partner' })

    const own = await app.inject({ method: 'GET', url: '/auth/partner/session', headers: { authorization } })
    expect(own.statusCode).toBe(200)
    expect(own.json().kind).toBe('partner')

    for (const url of ['/auth/merchant/session', '/auth/session', '/auth/me']) {
      const other = await app.inject({ method: 'GET', url, headers: { authorization } })
      expect(other.statusCode, url).toBe(403)
      expect(other.json().type, url).toBe(PROBLEMS.INSUFFICIENT_PERMISSION.type)
    }
  })

  it('signs an organisation principal out, and the session is gone afterwards', async () => {
    const { userId } = await organisationUser('merchant', 'pending')
    const { authorization } = await bearerFor(app, { accountId: userId, accountKind: 'merchant' })

    const out = await app.inject({ method: 'POST', url: '/auth/merchant/sign-out', headers: { authorization } })
    expect(out.statusCode).toBe(204)

    const after = await app.inject({ method: 'GET', url: '/auth/merchant/session', headers: { authorization } })
    expect(after.statusCode).toBe(PROBLEMS.SESSION_REVOKED.status)
    expect(after.json().type).toBe(PROBLEMS.SESSION_REVOKED.type)
  })
})
