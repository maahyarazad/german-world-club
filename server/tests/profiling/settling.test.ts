import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { approvedMember, profilingCalls, germanQ1toQ5 } from './support.ts'
import type { GwcApp } from '../../src/app.ts'

/** Q1: "Do you already know where you'll settle?" — for the member only; the partner starts at Q2. */

let app: GwcApp
let call: ReturnType<typeof profilingCalls>
beforeAll(async () => { app = await buildAuthApp(); call = profilingCalls(app) })
afterAll(async () => { await app.close() })
beforeEach(async () => { await resetAuthTables(app.pg) })

const { settlingStatus: _own, ...restOfQ1toQ5 } = germanQ1toQ5
const rest = { ...restOfQ1toQ5, relationshipStatus: ['single'], desiredWorkType: 'employee', futureWorkSector: 'technology_it', futureWorkReady: true }

describe.skipIf(!hasDatabase)('settling (Q1)', () => {
  it('"please help" needs nothing more', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...rest, settlingStatus: 'need_help' })
    expect((await call.submit(authorization)).statusCode).toBe(200)
  })

  it('"yes" needs a country and a city', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...rest, settlingStatus: 'know_where' })
    const refused = await call.submit(authorization)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().detail).toContain('settling-place')

    await call.patch(authorization, { settlingCountry: 'DE', settlingCity: 'Munich' })
    expect((await call.submit(authorization)).statusCode).toBe(200)
  })

  it('only Dubai asks how long the member has been working, as one of five bands', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...rest, settlingStatus: 'know_where', settlingCountry: 'AE', settlingCity: 'Dubai' })
    const refused = await call.submit(authorization)
    expect(refused.json().detail).toContain('settling-work')
    expect((await call.patch(authorization, { settlingWorkDuration: 'twelve' })).statusCode).toBe(400)

    for (const band of ['under_1', '1_3', '3_5', '5_10', 'over_10']) {
      expect((await call.patch(authorization, { settlingWorkDuration: band })).json().answers.settlingWorkDuration).toBe(band)
    }
    expect((await call.submit(authorization)).statusCode).toBe(200)
  })

  it('refuses the duration for any other city, and place fields for "please help"', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { settlingStatus: 'know_where', settlingCountry: 'DE', settlingCity: 'Berlin' })
    expect((await call.patch(authorization, { settlingWorkDuration: 'over_10' })).statusCode).toBe(400)

    await call.patch(authorization, { settlingStatus: 'need_help' })
    expect((await call.patch(authorization, { settlingCity: 'Berlin' })).statusCode).toBe(400)
  })

  it('clears the place and duration when the answer or the city changes', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { settlingStatus: 'know_where', settlingCountry: 'AE', settlingCity: 'Dubai', settlingWorkDuration: '3_5' })

    // Leaving Dubai drops the duration; the place stays.
    let res = await call.patch(authorization, { settlingCountry: 'AE', settlingCity: 'Sharjah' })
    expect(res.json().answers).toMatchObject({ settlingCity: 'Sharjah', settlingWorkDuration: null })

    // A different country invalidates the old city.
    res = await call.patch(authorization, { settlingCountry: 'FR' })
    expect(res.json().answers).toMatchObject({ settlingCountry: 'FR', settlingCity: null })

    // "Please help" clears everything.
    await call.patch(authorization, { settlingCity: 'Paris' })
    res = await call.patch(authorization, { settlingStatus: 'need_help' })
    expect(res.json().answers).toMatchObject({ settlingStatus: 'need_help', settlingCountry: null, settlingCity: null, settlingWorkDuration: null })
  })

  it('rejects a city that is not on the list for a listed country, and accepts free text for an unlisted one', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    expect((await call.patch(authorization, { settlingStatus: 'know_where', settlingCountry: 'DE', settlingCity: 'Atlantis' })).statusCode).toBe(400)
    // Liechtenstein is not among the 160 countries of the workbook.
    const res = await call.patch(authorization, { settlingStatus: 'know_where', settlingCountry: 'LI', settlingCity: 'Vaduz' })
    expect(res.statusCode).toBe(200)
    expect(res.json().answers.settlingCity).toBe('Vaduz')
  })

  it('does not ask the partner where they will settle, and refuses the fields', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { ...rest, settlingStatus: 'need_help', relationshipStatus: ['partner'] })
    await call.patch(authorization, { partner: { languages: ['de'], qualificationLevel: 'doctorate', occupation: 'other', yearlyIncomeRange: 'over_1m' } })
    // The four partner answers are enough: nothing about settling is missing.
    expect((await call.submit(authorization)).statusCode).toBe(200)
  })

  it('refuses settling fields on the partner, while the member\'s own are still accepted', async () => {
    const { authorization } = await approvedMember(app, 'DE')
    await call.patch(authorization, { relationshipStatus: ['partner'] })
    for (const field of [{ settlingStatus: 'know_where' }, { settlingCountry: 'AE' }, { settlingCity: 'Dubai' }, { settlingWorkDuration: 'under_1' }]) {
      expect((await call.patch(authorization, { partner: field })).statusCode).toBe(400)
    }
    expect((await call.patch(authorization, { settlingStatus: 'need_help' })).statusCode).toBe(200)
  })
})
