import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { deliverDueMail } from '../../src/decorators/mail.ts'
import { hasDatabase } from '../helpers/db.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { buildOnboardingApp, applicant, register, emailCodeFor } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The email verification code is sent in the request and never queued.
 *
 * A code delivered minutes later by the `mail.deliver` job is a stale code —
 * the applicant has resent or given up — and while it waits it sits readable in
 * `mail_outbox`. So the code either leaves now or the request says it could
 * not (503 service-unavailable, answered with "resend"), and the outbox never
 * sees it either way.
 */
describe.skipIf(!hasDatabase)('the email verification code', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  let mail: { failing: boolean; sent: { to: string; template: string }[] }

  beforeAll(async () => { ({ app, sms, mail } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
    mail.sent.length = 0
    mail.failing = false
  })

  /** Register and confirm the mobile, leaving the applicant at the email step. */
  async function atEmailStep() {
    const details = applicant()
    const { challengeId } = (await register(app, details)).json()
    const verified = await app.inject({
      method: 'POST', url: '/onboarding/verify-mobile',
      payload: { challengeId, code: sms.at(-1)!.code, deviceId: details.deviceId },
    })
    return { email: String(details.email), headers: { authorization: `Bearer ${verified.json().accessToken}` } }
  }

  const queuedCodes = async (to: string) => (await app.pg.query(
    `SELECT 1 FROM mail_outbox WHERE to_address = $1 AND template = 'onboarding.email-code'`, [to])).rowCount

  it('is sent before the request answers, and never written to the outbox', async () => {
    const { email, headers } = await atEmailStep()

    const response = await app.inject({ method: 'POST', url: '/onboarding/email/send', headers })

    expect(response.statusCode).toBe(202)
    expect(await emailCodeFor(app, email)).toMatch(/^\d+$/)
    expect(await queuedCodes(email)).toBe(0)
    // Nothing is left for the job to send again.
    const codesSent = () => mail.sent.filter((m) => m.template === 'onboarding.email-code').length
    expect(codesSent()).toBe(1)
    await deliverDueMail(app)
    expect(codesSent()).toBe(1)
  })

  it('answers 503 when the mail server fails, and leaves nothing to arrive later', async () => {
    const { email, headers } = await atEmailStep()
    mail.failing = true

    const response = await app.inject({ method: 'POST', url: '/onboarding/email/send', headers })

    expect(response.statusCode).toBe(503)
    expect(response.json().type).toBe(PROBLEMS.SERVICE_UNAVAILABLE.type)
    expect(await queuedCodes(email)).toBe(0)

    // Counter-assertion: once the provider recovers, the job still delivers no
    // code — only a fresh "resend" does.
    mail.failing = false
    await deliverDueMail(app)
    expect(await emailCodeFor(app, email)).toBeUndefined()

    const resent = await app.inject({ method: 'POST', url: '/onboarding/email/send', headers })
    expect(resent.statusCode).toBe(202)
    expect(await emailCodeFor(app, email)).toMatch(/^\d+$/)
  })
})
