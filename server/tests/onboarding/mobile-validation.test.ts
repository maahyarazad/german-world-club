import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, register, applicant } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 031: a mistyped number is a 422 the client can act on, not a 503 outage.
 *
 * The number from the bug report — `971585831595` typed with its country code but no
 * `+` and glued onto Germany as `+49971585831595` — has the right SHAPE and is not a
 * number. It used to reach the SMS provider, which refused it, and the server called
 * that "Verification unavailable". Each case has its counter-assertion: an outage is
 * still an outage, and a real number still registers.
 */
let app: GwcApp
let sms: { mobile: string; code: string }[]
let smsControl: { failure: unknown }
beforeAll(async () => { ({ app, sms, smsControl } = await buildOnboardingApp()) })
afterAll(async () => { await app.close() })

const memberRows = async (email: string) =>
  (await app.pg.query('SELECT 1 FROM members WHERE email = $1', [email])).rows.length

describe.skipIf(!hasDatabase)('registering with a mobile number', () => {
  it('refuses the number from the bug report with 422 invalid-mobile, creates nothing and sends nothing', async () => {
    const details = applicant({ mobile: '+49971585831595' })
    const before = sms.length
    const response = await register(app, details)
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toBe(PROBLEMS.INVALID_MOBILE.type)
    expect(await memberRows(String(details.email))).toBe(0)
    expect(sms).toHaveLength(before)
  })

  it('refuses a number that is only the right shape, however it is wrong', async () => {
    for (const mobile of ['+971971585831595', '+4912345678901', '+10000000000']) {
      const response = await register(app, applicant({ mobile }))
      expect(response.statusCode, mobile).toBe(422)
      expect(response.json().type, mobile).toBe(PROBLEMS.INVALID_MOBILE.type)
    }
  })

  it('still answers a number with no + as a request error, which a client never sends', async () => {
    const response = await register(app, applicant({ mobile: '971585831595' }))
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)
  })

  it('registers a real UAE number with exactly one code (counter-assertion for the refusals)', async () => {
    const before = sms.length
    // A fresh UAE number each run (members.mobile is unique and the database outlives a run).
    const mobile = `+97150${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`
    const response = await register(app, applicant({ mobile }))
    expect(response.statusCode).toBe(202)
    expect(sms).toHaveLength(before + 1)
    expect(sms.at(-1)!.mobile).toBe(mobile)
  })

  describe('when the SMS provider refuses', () => {
    it('answers 422 invalid-mobile when it refuses the DESTINATION, and rolls the account back', async () => {
      const details = applicant()
      smsControl.failure = { statusCode: 400, data: { errors: { destination: 'Invalid destination' } } }
      try {
        const response = await register(app, details)
        expect(response.statusCode).toBe(422)
        expect(response.json().type).toBe(PROBLEMS.INVALID_MOBILE.type)
        expect(await memberRows(String(details.email))).toBe(0)
      } finally {
        smsControl.failure = null
      }
      // The same applicant can register again once the number is right: nothing was left behind.
      const again = await register(app, { ...details, mobile: applicant().mobile })
      expect(again.statusCode).toBe(202)
    })

    it('stays 503 for an outage — a provider fault, a refused sender, a dead network', async () => {
      const failures = [
        { statusCode: 503, data: 'provider down' },
        { statusCode: 400, data: { errors: { origin: 'Sender id is not registered' } } },
        { statusCode: 401, data: 'bad credentials' },
        new Error('ECONNREFUSED'),
      ]
      for (const failure of failures) {
        smsControl.failure = failure
        try {
          const response = await register(app, applicant())
          expect(response.statusCode, JSON.stringify(failure)).toBe(503)
          expect(response.json().type).toBe(PROBLEMS.SERVICE_UNAVAILABLE.type)
        } finally {
          smsControl.failure = null
        }
      }
    })
  })
})
