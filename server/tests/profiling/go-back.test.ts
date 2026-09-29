import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls, germanQ1toQ5 } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** Story 5: any answer can be changed until submit, and nothing stale survives. */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

describe.skipIf(!hasDatabase)('going back and changing an answer', () => {
  it('re-answering a field replaces it and leaves the others alone', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { settlingStatus: 'know_where', languages: ['en'], yearlyIncomeRange: 'over_100k' })
    const res = await call.patch(authorization, { languages: ['en', 'de'] })
    expect(res.json().answers).toMatchObject({ settlingStatus: 'know_where', languages: ['en', 'de'], yearlyIncomeRange: 'over_100k' })

    const again = await call.patch(authorization, { settlingStatus: 'need_help' })
    expect(again.json().answers).toMatchObject({ settlingStatus: 'need_help', languages: ['en', 'de'] })
  })

  it('a change made after everything is answered is what gets submitted', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, {
      ...germanQ1toQ5, relationshipStatus: ['single'], desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
    })
    await call.patch(authorization, { occupation: 'lawyer_legal_professional' }) // the "mistake" fixed at the end
    const res = await call.submit(authorization)
    expect(res.json().answers.occupation).toBe('lawyer_legal_professional')
  })

  it('changing the Q7 path drops the old follow-ups and asks the new ones', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, {
      ...germanQ1toQ5, relationshipStatus: ['single'], desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true,
    })
    const res = await call.patch(authorization, { desiredWorkType: 'freelance' })
    expect(res.json().answers).toMatchObject({
      desiredWorkType: 'freelance', futureWorkSector: null, futureWorkReady: null,
    })
    expect((await call.submit(authorization)).statusCode).toBe(409)
  })

  it('replaces elsewhere cities, and removing a secondary really removes it', async () => {
    const { authorization } = await approvedMember(app, 'FR')
    const one = { country: 'ZZ', city: 'One' }
    const two = { country: 'ZZ', city: 'Two' }
    await call.patch(authorization, { primaryCity: one, secondaryCities: [two] })
    let res = await call.patch(authorization, { primaryCity: two, secondaryCities: [] })
    expect(res.json().answers.primaryCity).toEqual(two)
    expect(res.json().answers.secondaryCities).toEqual([])
    res = await call.patch(authorization, { primaryCity: one, secondaryCities: [two] })
    expect(res.json().answers.secondaryCities).toEqual([two])
  })

  it('a member who leaves and returns finds every answer, in a fresh read', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, {
      settlingStatus: 'need_help', relationshipStatus: ['kids', 'family'], kids: ['age_0_6', 'age_6_14'],
      partner: { languages: ['tr'] },
    })
    const fresh = (await call.status(authorization)).json()
    expect(fresh.answers).toMatchObject({
      settlingStatus: 'need_help', relationshipStatus: ['kids', 'family'], kids: ['age_0_6', 'age_6_14'],
      partner: { languages: ['tr'] },
    })
    expect(fresh.completed).toBe(false)
  })
})
