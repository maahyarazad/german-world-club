import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables, createMember, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Onboarding Phase 2 (feature 013): the profiling gate in `applyMemberGates`
 * (server/src/plugins/10-auth.ts), mirroring how tests/push/onboarding-gate.test.ts
 * exercises the Phase 1 equivalent.
 */

let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

async function memberWithApplication(state: 'pending' | 'approved' | 'denied' | null) {
  const row = await createMember(app.pg, { passwordHash: null })
  if (state) {
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at, reviewed_at, denial_reason)
       VALUES ($1, 'device-x', $2::approval_state, now(), now(), CASE WHEN $2 = 'denied' THEN 'no reason given' END)`,
      [row.id, state],
    )
  }
  const { authorization } = await bearerFor(app, { accountId: String(row.id), accountKind: 'member' })
  return { memberId: row.id, authorization }
}

const ordinary = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profile/me', headers })
const status = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/status', headers })
const gwcCities = (headers: Record<string, string>) =>
  app.inject({ method: 'GET', url: '/profiling/gwc-cities', headers })
const patch = (headers: Record<string, string>, payload: object) =>
  app.inject({ method: 'PATCH', url: '/profiling', headers, payload })

describe.skipIf(!hasDatabase)('the profiling gate', () => {
  it('refuses an approved, not-yet-profiled member on an ordinary member route', async () => {
    const { authorization } = await memberWithApplication('approved')
    const response = await ordinary({ authorization })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.PROFILING_INCOMPLETE.type)
  })

  it('still lets that same member reach both profiling routes', async () => {
    const { authorization } = await memberWithApplication('approved')
    expect((await status({ authorization })).statusCode).toBe(200)
    expect((await patch({ authorization }, { primaryCity: { country: 'GB', city: 'London' } })).statusCode).toBe(200)
  })

  it('keeps the member gated after the last answer is saved, and opens the routes on submit only', async () => {
    const { authorization } = await memberWithApplication('approved')
    await patch({ authorization }, { primaryCity: { country: 'GB', city: 'London' }, relationshipStatus: ['single'] })
    // Every elsewhere answer is saved, and the gate has not moved.
    expect((await ordinary({ authorization })).statusCode).toBe(403)

    const done = await app.inject({ method: 'POST', url: '/profiling/submit', headers: { authorization } })
    expect(done.statusCode).toBe(200)
    expect((await ordinary({ authorization })).statusCode).toBe(200)
  })

  it('lets that same member read the GWC city dropdown data', async () => {
    const { authorization } = await memberWithApplication('approved')
    const response = await gwcCities({ authorization })
    expect(response.statusCode).toBe(200)
    const cities = response.json() as { country: string; city: string }[]
    expect(cities.every((c) => typeof c.country === 'string' && typeof c.city === 'string')).toBe(true)
  })

  it('opens the ordinary route once profiling is complete', async () => {
    const { memberId, authorization } = await memberWithApplication('approved')
    await app.pg.query(
      `INSERT INTO member_profiling (member_id, branch, primary_city_country, primary_city_name, outcome, completed_at)
       VALUES ($1, 'elsewhere', 'ZZ', 'Nowhereville', 'in_person_meeting', now())`,
      [memberId],
    )
    expect((await ordinary({ authorization })).statusCode).toBe(200)
  })

  it('leaves a member with no application row untouched', async () => {
    const member = await createMember(app.pg)
    const { authorization } = await bearerFor(app, { accountId: String(member.id), accountKind: 'member' })
    expect((await ordinary({ authorization })).statusCode).toBe(200)
  })

  it('still refuses a pending applicant before the profiling check is reached', async () => {
    const { authorization } = await memberWithApplication('pending')
    const response = await ordinary({ authorization })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.APPROVAL_PENDING.type)
  })

  it('still refuses a denied applicant before the profiling check is reached', async () => {
    const { authorization } = await memberWithApplication('denied')
    const response = await ordinary({ authorization })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.APPLICATION_DENIED.type)
  })
})
