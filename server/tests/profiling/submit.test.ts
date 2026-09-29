import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls, germanQ1toQ5 } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** `POST /profiling/submit` is the only thing that completes profiling (research R10). */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

const ordinary = (authorization: string) =>
  app.inject({ method: 'GET', url: '/profile/me', headers: { authorization } })

const fullGerman = {
  ...germanQ1toQ5, relationshipStatus: ['single'], desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
}

describe.skipIf(!hasDatabase)('POST /profiling/submit', () => {
  it('a PATCH carrying every answer does not complete; ordinary routes stay closed', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    const res = await call.patch(authorization, fullGerman)
    expect(res.json().completed).toBe(false)
    expect((await ordinary(authorization)).statusCode).toBe(403)
  })

  it('refuses with profiling-answers-missing, naming the step, and changes nothing', async () => {
    const { memberId, authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...fullGerman, futureWorkReady: undefined })
    const before = await app.pg.query('SELECT completed_at, updated_at FROM member_profiling WHERE member_id = $1', [memberId])

    const res = await call.submit(authorization)
    expect(res.statusCode).toBe(409)
    expect(res.json().type).toBe(PROBLEMS.PROFILING_ANSWERS_MISSING.type)
    expect(res.json().detail).toContain('work-ready')

    const after = await app.pg.query('SELECT completed_at, updated_at FROM member_profiling WHERE member_id = $1', [memberId])
    expect(after.rows[0]).toEqual(before.rows[0])
    expect(after.rows[0].completed_at).toBeNull()
  })

  it('refuses a member who has answered nothing', async () => {
    const { memberId, authorization } = await approvedMember(app, 'DE')
    const res = await call.submit(authorization)
    expect(res.statusCode).toBe(409)
    expect(res.json().detail).toContain('settling')
    const { rows } = await app.pg.query('SELECT 1 FROM member_profiling WHERE member_id = $1', [memberId])
    expect(rows).toHaveLength(0)
  })

  it('completes a fully answered German member and opens ordinary routes', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, fullGerman)
    const res = await call.submit(authorization)
    expect(res.statusCode).toBe(200)
    expect(res.json().completed).toBe(true)
    expect((await ordinary(authorization)).statusCode).toBe(200)
  })

  it('resolves the elsewhere outcome at submit, from the cities as saved', async () => {
    const { rows } = await app.pg.query('SELECT country, city FROM gwc_cities ORDER BY city LIMIT 1')
    const gwc = rows[0] as { country: string; city: string }

    const a = await approvedMember(app, 'FR')
    await call.patch(a.authorization, { primaryCity: gwc, relationshipStatus: ['single'] })
    expect((await call.status(a.authorization)).json()).toMatchObject({ outcome: null, matchedCity: null })
    expect((await call.submit(a.authorization)).json()).toMatchObject({ outcome: 'gwc_city_match', matchedCity: gwc })

    const b = await approvedMember(app, 'FR')
    await call.patch(b.authorization, { primaryCity: { country: 'ZZ', city: 'Nowhere' }, relationshipStatus: ['single'] })
    expect((await call.submit(b.authorization)).json()).toMatchObject({ outcome: 'in_person_meeting', matchedCity: null })
  })

  it('uses the cities as they are at submit time after a change', async () => {
    const { rows } = await app.pg.query('SELECT country, city FROM gwc_cities ORDER BY city LIMIT 1')
    const { authorization } = await approvedMember(app, 'FR')
    await call.patch(authorization, { primaryCity: rows[0], relationshipStatus: ['single'] })
    await call.patch(authorization, { primaryCity: { country: 'ZZ', city: 'Nowhere' } })
    expect((await call.submit(authorization)).json().outcome).toBe('in_person_meeting')
  })

  it('refuses a second submit and any later PATCH', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, fullGerman)
    await call.submit(authorization)
    expect((await call.submit(authorization)).statusCode).toBe(409)
    expect((await call.submit(authorization)).json().type).toBe(PROBLEMS.CONFLICT.type)
    expect((await call.patch(authorization, { occupation: 'student' })).statusCode).toBe(409)
  })
})
