import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, applicant, register } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/** Register captures the age confirmation and the primary language (business description, Phase 1). */
describe.skipIf(!hasDatabase)('register: age confirmation and primary language', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg); sms.length = 0 })

  it('refuses a registration without the age confirmation or with it unticked', async () => {
    const { ageConfirmed: _omitted, ...without } = applicant()
    expect((await register(app, without)).statusCode).toBe(400)
    expect((await register(app, applicant({ ageConfirmed: false }))).statusCode).toBe(400)
    // Counter-assertion: nothing was created by either refusal.
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM membership_applications')
    expect(rows[0].n).toBe(0)
  })

  it('refuses a missing or unknown primary language', async () => {
    const { primaryLanguage: _omitted, ...without } = applicant()
    expect((await register(app, without)).statusCode).toBe(400)
    expect((await register(app, applicant({ primaryLanguage: 'french' }))).statusCode).toBe(400)
  })

  it.each(['german', 'non_german'])('stores %s and the moment of confirmation', async (primaryLanguage) => {
    const details = applicant({ primaryLanguage, countryOfResidence: 'AT' })
    const res = await register(app, details)
    expect(res.statusCode).toBe(202)
    const { rows } = await app.pg.query(
      'SELECT primary_language, age_confirmed_at, country_of_residence FROM members WHERE email = $1', [details.email],
    )
    expect(rows[0].primary_language).toBe(primaryLanguage)
    expect(rows[0].age_confirmed_at).not.toBeNull()
    expect(rows[0].country_of_residence).toBe('AT')
  })

  it('answers a taken address exactly like a fresh one (no membership oracle)', async () => {
    const first = applicant()
    const a = await register(app, first)
    const b = await register(app, applicant({ email: first.email, mobile: first.mobile }))
    expect(Object.keys(b.json()).sort()).toEqual(Object.keys(a.json()).sort())
    expect(b.statusCode).toBe(a.statusCode)
  })
})
