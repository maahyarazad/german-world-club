import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { resetAuthTables, createAdmin, bearerFor, createMember } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, applicant, submitApplication, emailCodeFor, register, DEVICE } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Mobile onboarding, Phase 1 (§6.1): register → verify mobile → verify email
 * → waiting for approval → staff approve or deny, with an email either way.
 *
 * Every step is driven through the real endpoints. The assertions are about
 * what an applicant can and cannot reach at each point, because the whole
 * feature is one question asked five times: may this person in yet?
 */
describe.skipIf(!hasDatabase)('mobile onboarding (§6.1)', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  const staffHeaders = async () => {
    const admin = await createAdmin(app.pg, { grants: { members: { read: true, status: true } } })
    app.permissions.invalidateAll?.()
    return { admin, headers: await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' }) }
  }

  describe('registration', () => {
    it('creates a pending application and texts a code, echoing only a masked number', async () => {
      const details = applicant()
      const response = await register(app, details)

      expect(response.statusCode).toBe(202)
      expect(response.json().sentTo).toBe('•••• 5678')
      expect(JSON.stringify(response.json())).not.toContain('15112345678')
      expect(sms).toHaveLength(1)
      expect(sms[0]!.code).toMatch(/^\d{4}$/)

      const { rows } = await app.pg.query(
        `SELECT m.display_name, m.gender, m.country_of_residence, to_char(m.birthday, 'YYYY-MM-DD') AS birthday,
                m.mobile_verified_at, m.email_confirmed_at, a.state, a.device_id, a.submitted_at
           FROM members m JOIN membership_applications a ON a.member_id = m.id WHERE m.email = $1`,
        [details.email],
      )
      expect(rows[0]).toMatchObject({
        display_name: 'Anna Applicant', gender: 'female', country_of_residence: 'DE', birthday: '1990-04-12',
        mobile_verified_at: null, email_confirmed_at: null, state: 'pending', device_id: DEVICE, submitted_at: null,
      })
    })

    it('answers an address already in use with the same shape, sends no SMS, and tells the owner', async () => {
      const owner = await createMember(app.pg)
      const response = await register(app, applicant({ email: owner.email }))
      const fresh = await register(app, applicant())

      expect(response.statusCode).toBe(fresh.statusCode)
      expect(Object.keys(response.json()).sort()).toEqual(Object.keys(fresh.json()).sort())
      // One SMS — for the fresh address only.
      expect(sms).toHaveLength(1)
      const { rows } = await app.pg.query(
        `SELECT template FROM mail_outbox WHERE to_address = $1`, [owner.email],
      )
      expect(rows.map((r) => r.template)).toEqual(['onboarding.address-in-use'])
    })

    it('rolls the application back when the SMS cannot be sent', async () => {
      const failing = await buildOnboardingApp()
      try {
        ;(failing.app.integrations.sms as { sendCode: unknown }).sendCode = async () => {
          throw Object.assign(new Error('provider down'), { statusCode: 503 })
        }
        const details = applicant()
        const response = await register(failing.app, details)
        expect(response.statusCode).toBeGreaterThanOrEqual(500)
        const { rows } = await failing.app.pg.query('SELECT 1 FROM members WHERE email = $1', [details.email])
        // Nothing half-created: the applicant can simply try again.
        expect(rows).toHaveLength(0)
      } finally {
        await failing.app.close()
      }
    })

    it('limits registrations per address, and fails closed', async () => {
      const address = '198.51.100.77'
      const statuses = []
      for (let i = 0; i < 6; i += 1) statuses.push((await register(app, applicant(), address)).statusCode)
      expect(statuses.slice(0, 5).every((s) => s === 202)).toBe(true)
      expect(statuses[5]).toBe(429)
      // The counter-assertion: the limit is per address, not a closed door.
      expect((await register(app, applicant())).statusCode).toBe(202)
    })

    it('refuses a birthday that is not a real past date', async () => {
      for (const birthday of ['2023-02-30', '2999-01-01', '12.04.1990']) {
        const response = await register(app, applicant({ birthday }))
        expect(response.statusCode, birthday).toBe(400)
      }
    })
  })

  describe('before approval', () => {
    it('walks every step to "awaiting approval"', async () => {
      const { status } = await submitApplication(app, sms)
      expect(status.step).toBe('awaiting_approval')
      expect(status.submittedAt).toBeTruthy()
    })

    it('reports each step from the facts as the applicant reaches it', async () => {
      const details = applicant()
      const { challengeId } = (await register(app, details)).json()
      const tokens = (await app.inject({
        method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code: sms[0]!.code, deviceId: DEVICE },
      })).json()
      const headers = { authorization: `Bearer ${tokens.accessToken}` }

      const status = await app.inject({ method: 'GET', url: '/onboarding/status', headers })
      expect(status.json().step).toBe('verify_email')
    })

    it('keeps an applicant out of every member route, while /onboarding stays open', async () => {
      const { headers } = await submitApplication(app, sms)

      for (const url of ['/profile/me', '/threads/feed', '/member/events', '/auth/me']) {
        const response = await app.inject({ method: 'GET', url, headers })
        expect(response.statusCode, url).toBe(403)
        expect(response.json().type, url).toBe(PROBLEMS.APPROVAL_PENDING.type)
      }
      // The counter-assertion: the same credential still reaches onboarding,
      // so the refusals above are the approval gate and not a dead token.
      expect((await app.inject({ method: 'GET', url: '/onboarding/status', headers })).statusCode).toBe(200)
    })

    it('gives an applicant no token when they sign in on the web', async () => {
      const { details } = await submitApplication(app, sms)
      const response = await app.inject({
        method: 'POST', url: '/auth/sign-in', payload: { email: details.email, password: details.password },
      })
      expect(response.json().outcome).toBe('approval_pending')
      expect(response.json().accessToken).toBeUndefined()
    })

    it('lets an applicant resume on the device they applied from, by SMS', async () => {
      const { details } = await submitApplication(app, sms)
      const response = await app.inject({
        method: 'POST', url: '/auth/sign-in', payload: { email: details.email, password: details.password, deviceId: DEVICE },
      })
      expect(response.json().outcome).toBe('otp_required')
      // A different phone gets nowhere.
      const elsewhere = await app.inject({
        method: 'POST', url: '/auth/sign-in', payload: { email: details.email, password: details.password, deviceId: 'another-phone' },
      })
      expect(elsewhere.json().outcome).toBe('approval_pending')
    })

    it('resends a mobile code under a new challenge, and that challenge verifies', async () => {
      const details = applicant()
      const { challengeId } = (await register(app, details)).json()
      // Past the resend cooldown, without waiting for it.
      await app.pg.query(`UPDATE otp_challenges SET created_at = now() - interval '2 minutes' WHERE id = $1`, [challengeId])

      const resent = await app.inject({ method: 'POST', url: '/auth/otp/resend', payload: { challengeId } })
      expect(resent.statusCode).toBe(202)
      const fresh = resent.json().challengeId
      expect(fresh).not.toBe(challengeId)

      const verified = await app.inject({
        method: 'POST', url: '/onboarding/verify-mobile',
        payload: { challengeId: fresh, code: sms[sms.length - 1]!.code, deviceId: DEVICE },
      })
      expect(verified.statusCode).toBe(200)
    })

    it('never redeems an email code as a sign-in code', async () => {
      const details = applicant()
      const { challengeId } = (await register(app, details)).json()
      const tokens = (await app.inject({
        method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code: sms[0]!.code, deviceId: DEVICE },
      })).json()
      const sent = (await app.inject({
        method: 'POST', url: '/onboarding/email/send', headers: { authorization: `Bearer ${tokens.accessToken}` },
      })).json()
      const code = await emailCodeFor(app, details.email)

      const misuse = await app.inject({
        method: 'POST', url: '/auth/verify-otp', payload: { challengeId: sent.challengeId, code: code!.slice(0, 4), deviceId: DEVICE },
      })
      expect(misuse.statusCode).toBe(401)
      expect(misuse.json().accessToken).toBeUndefined()
    })
  })

  describe('staff review', () => {
    it('lists only submitted applications', async () => {
      await register(app, applicant()) // stalls at SMS
      const { memberId } = await submitApplication(app, sms)
      const { headers } = await staffHeaders()

      const response = await app.inject({ method: 'GET', url: '/admin/onboarding/applications', headers })
      expect(response.statusCode).toBe(200)
      expect(response.json().items.map((a: { memberId: string }) => a.memberId)).toEqual([memberId])
    })

    it('approval opens the member routes, approves that device, and queues the email', async () => {
      const { memberId, headers: applicantHeaders, details } = await submitApplication(app, sms)
      const { headers } = await staffHeaders()

      const approved = await app.inject({ method: 'POST', url: `/admin/onboarding/applications/${memberId}/approve`, headers })
      expect(approved.statusCode).toBe(200)
      expect(approved.json().state).toBe('approved')

      expect((await app.inject({ method: 'GET', url: '/profile/me', headers: applicantHeaders })).statusCode).toBe(200)
      const status = await app.inject({ method: 'GET', url: '/onboarding/status', headers: applicantHeaders })
      expect(status.json().step).toBe('approved')

      const { rows: device } = await app.pg.query(
        'SELECT state FROM device_approvals WHERE member_id = $1 AND device_id = $2', [memberId, DEVICE],
      )
      expect(device[0]?.state).toBe('approved')
      const { rows: mail } = await app.pg.query('SELECT template FROM mail_outbox WHERE to_address = $1 AND template = $2', [details.email, 'onboarding.approved'])
      expect(mail).toHaveLength(1)
    })

    it('denial needs a reason, shows it to the applicant, and keeps them out', async () => {
      const { memberId, headers: applicantHeaders } = await submitApplication(app, sms)
      const { headers } = await staffHeaders()

      const noReason = await app.inject({ method: 'POST', url: `/admin/onboarding/applications/${memberId}/deny`, headers, payload: {} })
      expect(noReason.statusCode).toBe(400)

      const denied = await app.inject({
        method: 'POST', url: `/admin/onboarding/applications/${memberId}/deny`, headers,
        payload: { reason: 'We could not verify your details.' },
      })
      expect(denied.statusCode).toBe(200)

      const status = (await app.inject({ method: 'GET', url: '/onboarding/status', headers: applicantHeaders })).json()
      expect(status).toMatchObject({ step: 'denied', denialReason: 'We could not verify your details.' })
      const refused = await app.inject({ method: 'GET', url: '/profile/me', headers: applicantHeaders })
      expect(refused.json().type).toBe(PROBLEMS.APPLICATION_DENIED.type)
    })

    it('decides once: a second decision is a conflict and changes nothing', async () => {
      const { memberId } = await submitApplication(app, sms)
      const { headers } = await staffHeaders()
      await app.inject({ method: 'POST', url: `/admin/onboarding/applications/${memberId}/approve`, headers })

      const again = await app.inject({
        method: 'POST', url: `/admin/onboarding/applications/${memberId}/deny`, headers, payload: { reason: 'Changed my mind' },
      })
      expect(again.statusCode).toBe(409)
      const { rows } = await app.pg.query('SELECT state FROM membership_applications WHERE member_id = $1', [memberId])
      expect(rows[0]?.state).toBe('approved')
    })

    it('records each decision in the audit log', async () => {
      const { memberId } = await submitApplication(app, sms)
      const { admin, headers } = await staffHeaders()
      await app.inject({ method: 'POST', url: `/admin/onboarding/applications/${memberId}/approve`, headers })

      const { rows } = await app.pg.query(
        `SELECT actor_id FROM audit_log WHERE action = 'membership_application_approved' AND target_id = $1`, [memberId],
      )
      expect(rows.map((r) => r.actor_id)).toEqual([admin.id])
    })
  })

  it('leaves invited and legacy members alone — no application, no gate', async () => {
    const member = await createMember(app.pg)
    const headers = await bearerFor(app, { accountId: String(member.id), accountKind: 'member' })
    expect((await app.inject({ method: 'GET', url: '/profile/me', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/onboarding/status', headers })).json().step).toBe('approved')
  })
})
