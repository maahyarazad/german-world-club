import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-001: only full members (approved, profiling complete) get a link. No
 * referral code does that — the member route carries neither `onboarding` nor
 * `profiling`, so 10-auth's existing gates refuse applicants. This suite
 * proves the posture rather than trusting it.
 */
describe.skipIf(!hasDatabase)('referrals refuse applicants', () => {
  let app: GwcApp

  beforeAll(async () => { ({ app } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg) })

  async function withApplication(state: 'pending' | 'approved', profiled: boolean) {
    const owner = await memberOwner(app)
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at)
       VALUES ($1, NULL, $2::approval_state, now(), CASE WHEN $2 = 'approved' THEN now() END)`,
      [owner.id, state],
    )
    if (profiled) {
      await app.pg.query(
        `INSERT INTO member_profiling (member_id, branch, completed_at) VALUES ($1, 'germany', now())`, [owner.id],
      )
    }
    return owner
  }

  it('refuses an applicant still waiting for approval', async () => {
    const owner = await withApplication('pending', false)
    const response = await app.inject({ method: 'GET', url: '/referrals', headers: owner.headers })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.APPROVAL_PENDING.type)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM referral_links WHERE owner_id = $1', [owner.id])
    expect(rows[0].n).toBe(0)
  })

  it('refuses an approved member who has not finished profiling', async () => {
    const owner = await withApplication('approved', false)
    const response = await app.inject({ method: 'GET', url: '/referrals', headers: owner.headers })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.PROFILING_INCOMPLETE.type)
  })

  it('answers an approved, profiled member', async () => {
    // Counter-assertion: the refusals above are about the gates, not the route.
    const owner = await withApplication('approved', true)
    const response = await app.inject({ method: 'GET', url: '/referrals', headers: owner.headers })
    expect(response.statusCode).toBe(200)
  })
})
