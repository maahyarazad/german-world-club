import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, register, applicant, uniqueMobile, nextAddress, DEVICE } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Step 3: an applicant who mistyped their email or number corrects it without
 * starting over (application/contact.ts), and cannot take one already in use.
 */
describe.skipIf(!hasDatabase)('POST /onboarding/contact', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })

  const change = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/onboarding/contact', payload, remoteAddress: nextAddress() })
  const memberByEmail = async (email: string) =>
    (await app.pg.query('SELECT id, email, mobile FROM members WHERE email = $1', [email])).rows[0]

  async function registered(overrides: Record<string, unknown> = {}) {
    const details = applicant(overrides)
    const r = await register(app, details)
    expect(r.statusCode).toBe(202)
    return { details, challengeId: r.json().challengeId as string, member: await memberByEmail(String(details.email)) }
  }

  it('changes the number on the same account and texts the new code there', async () => {
    const { details, challengeId, member } = await registered()
    const newMobile = uniqueMobile()
    const r = await change({ challengeId, mobile: newMobile, deviceId: DEVICE })

    expect(r.statusCode).toBe(202)
    expect(r.json().challengeId).not.toBe(challengeId)
    expect(r.json().sentTo).toBe('•••• 5678')
    expect(sms.at(-1)!.mobile).toBe(newMobile)
    expect(await memberByEmail(String(details.email))).toMatchObject({ id: member.id, mobile: newMobile })

    // The old challenge is spent; the new code verifies.
    const old = await app.inject({
      method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code: sms.at(-2)!.code, deviceId: DEVICE },
    })
    expect(old.statusCode).not.toBe(200)
    const fresh = await app.inject({
      method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId: r.json().challengeId, code: sms.at(-1)!.code, deviceId: DEVICE },
    })
    expect(fresh.statusCode).toBe(200)
  })

  it('changes the email on the same account, leaving no second one behind', async () => {
    const { details, challengeId, member } = await registered()
    const newEmail = `corrected-${member.id}@test.invalid`
    const r = await change({ challengeId, email: newEmail, deviceId: DEVICE })

    expect(r.statusCode).toBe(202)
    expect(await memberByEmail(newEmail)).toMatchObject({ id: member.id })
    expect(await memberByEmail(String(details.email))).toBeUndefined()
  })

  it('refuses an email or number another member already has, and changes nothing', async () => {
    const taken = await registered()
    const { details, challengeId } = await registered()
    const before = sms.length

    const email = await change({ challengeId, email: String(taken.details.email).toUpperCase(), deviceId: DEVICE })
    expect(email.statusCode).toBe(409)
    expect(email.json().type).toBe(PROBLEMS.EMAIL_IN_USE.type)

    const mobile = await change({ challengeId, mobile: taken.details.mobile, deviceId: DEVICE })
    expect(mobile.statusCode).toBe(409)
    expect(mobile.json().type).toBe(PROBLEMS.MOBILE_IN_USE.type)

    expect(sms).toHaveLength(before)
    expect(await memberByEmail(String(details.email))).toMatchObject({ mobile: details.mobile })
  })

  it('refuses a registration with a number another member already has', async () => {
    const taken = await registered()
    const r = await register(app, applicant({ mobile: taken.details.mobile }))
    expect(r.statusCode).toBe(409)
    expect(r.json().type).toBe(PROBLEMS.MOBILE_IN_USE.type)
  })

  it('only the device that registered can change it, and only before verification', async () => {
    const { challengeId } = await registered()
    const otherDevice = await change({ challengeId, mobile: uniqueMobile(), deviceId: 'someone-else' })
    expect(otherDevice.statusCode).toBe(404)

    const verified = await app.inject({
      method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code: sms.at(-1)!.code, deviceId: DEVICE },
    })
    expect(verified.statusCode).toBe(200)
    const afterwards = await change({ challengeId, mobile: uniqueMobile(), deviceId: DEVICE })
    expect(afterwards.statusCode).toBe(404)
  })

  it('applies the SMS country policy to a new number', async () => {
    const { challengeId } = await registered()
    const r = await change({ challengeId, mobile: '+8501912345678', deviceId: DEVICE })
    expect(r.statusCode).toBe(422)
    expect(r.json().type).toBe(PROBLEMS.SMS_DESTINATION_NOT_ALLOWED.type)
  })

  it('asks for something to change', async () => {
    const { challengeId } = await registered()
    expect((await change({ challengeId, deviceId: DEVICE })).statusCode).toBe(400)
  })
})
