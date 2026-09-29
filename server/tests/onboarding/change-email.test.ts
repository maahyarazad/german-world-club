import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, register, applicant, emailCodeFor, DEVICE } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Step 4: an applicant who mistyped their email corrects it before confirming
 * (PUT /onboarding/email), and cannot take one already in use.
 */
describe.skipIf(!hasDatabase)('PUT /onboarding/email', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })

  /** Register and verify the number: the applicant is signed in and on step 4. */
  async function atStepFour() {
    const details = applicant()
    const { challengeId } = (await register(app, details)).json()
    const verified = await app.inject({
      method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code: sms.at(-1)!.code, deviceId: DEVICE },
    })
    const headers = { authorization: `Bearer ${verified.json().accessToken}` }
    const sent = await app.inject({ method: 'POST', url: '/onboarding/email/send', headers })
    return { details, headers, oldChallengeId: sent.json().challengeId as string, memberId: String(verified.json().principal.id) }
  }
  const changeEmail = (headers: Record<string, string>, email: string) =>
    app.inject({ method: 'PUT', url: '/onboarding/email', headers, payload: { email } })

  it('changes the address, mails a new code there, and confirms with it', async () => {
    const { details, headers, oldChallengeId, memberId } = await atStepFour()
    const newEmail = `corrected-${memberId}@test.invalid`
    const oldCode = await emailCodeFor(app, String(details.email))

    const r = await changeEmail(headers, newEmail)
    expect(r.statusCode).toBe(202)
    expect(r.json().sentTo).toContain('@test.invalid')

    // The code sent to the mistyped address no longer confirms anything.
    const stale = await app.inject({
      method: 'POST', url: '/onboarding/email/verify', headers, payload: { challengeId: oldChallengeId, code: oldCode },
    })
    expect(stale.statusCode).not.toBe(200)

    const fresh = await app.inject({
      method: 'POST', url: '/onboarding/email/verify', headers,
      payload: { challengeId: r.json().challengeId, code: await emailCodeFor(app, newEmail) },
    })
    expect(fresh.statusCode).toBe(200)
    const { rows } = await app.pg.query('SELECT email, email_confirmed_at FROM members WHERE id = $1', [memberId])
    expect(rows[0].email).toBe(newEmail)
    expect(rows[0].email_confirmed_at).not.toBeNull()
  })

  it('refuses an address another member already has, and changes nothing', async () => {
    const other = await atStepFour()
    const { details, headers, memberId } = await atStepFour()
    const r = await changeEmail(headers, String(other.details.email).toUpperCase())
    expect(r.statusCode).toBe(409)
    expect(r.json().type).toBe(PROBLEMS.EMAIL_IN_USE.type)
    const { rows } = await app.pg.query('SELECT email FROM members WHERE id = $1', [memberId])
    expect(rows[0].email).toBe(details.email)
  })

  it('refuses once the address is confirmed', async () => {
    const { details, headers, oldChallengeId, memberId } = await atStepFour()
    await app.inject({
      method: 'POST', url: '/onboarding/email/verify', headers,
      payload: { challengeId: oldChallengeId, code: await emailCodeFor(app, String(details.email)) },
    })
    const r = await changeEmail(headers, `late-${memberId}@test.invalid`)
    expect(r.statusCode).toBe(409)
    expect(r.json().type).toBe(PROBLEMS.CONFLICT.type)
  })

  it('needs the applicant\'s session', async () => {
    expect((await app.inject({ method: 'PUT', url: '/onboarding/email', payload: { email: 'x@test.invalid' } })).statusCode).toBe(401)
  })
})
