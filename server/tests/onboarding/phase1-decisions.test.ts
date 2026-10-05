import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { autoApproveDue } from '../../src/modules/onboarding/application/auto-approve.ts'
import { buildOnboardingApp, applicant, submitApplication } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Phase 1 decision rules: a Non-German applicant is denied automatically at
 * email verification and never reaches staff; a German one gets the 48-hour
 * thank-you email and is approved by a job after 24 hours.
 */
describe.skipIf(!hasDatabase)('Phase 1 decisions', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]
  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg); sms.length = 0 })

  const mails = async (to: string) => (await app.pg.query(
    'SELECT template FROM mail_outbox WHERE to_address = $1 ORDER BY id', [to])).rows.map((r) => r.template as string)
  const application = async (memberId: string) => (await app.pg.query(
    'SELECT state, decided_automatically, reviewed_by, denial_reason FROM membership_applications WHERE member_id = $1', [memberId])).rows[0]
  const staffQueue = async () => {
    const admin = await createAdmin(app.pg, { grants: { members: { read: true, status: true } } })
    app.permissions.invalidateAll?.()
    const headers = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
    const res = await app.inject({ method: 'GET', url: '/admin/onboarding/applications?state=pending', headers })
    return res.json().items as { memberId: string; primaryLanguage: string | null }[]
  }

  it('denies a Non-German speaker automatically, with the reason mailed, and keeps them out of the queue', async () => {
    const { details, memberId, status } = await submitApplication(app, sms, applicant({ primaryLanguage: 'non_german' }))
    expect(status.step).toBe('denied')
    expect(status.denialReason).toBeTruthy()
    expect(await application(memberId)).toMatchObject({ state: 'denied', decided_automatically: true, reviewed_by: null })
    expect(await mails(String(details.email))).toContain('onboarding.denied')
    expect(await mails(String(details.email))).not.toContain('onboarding.thank-you')
    expect((await staffQueue()).map((a) => a.memberId)).not.toContain(memberId)
    const audit = await app.pg.query(`SELECT actor_id, actor_kind FROM audit_log WHERE action = 'membership_application_denied' AND target_id = $1`, [memberId])
    expect(audit.rows).toEqual([{ actor_id: null, actor_kind: null }])
  })

  it('leaves a German speaker pending, queues the thank-you email once, and shows them to staff', async () => {
    const { details, memberId, status } = await submitApplication(app, sms, applicant())
    expect(status.step).toBe('awaiting_approval')
    expect(await application(memberId)).toMatchObject({ state: 'pending', decided_automatically: false })
    const sent = await mails(String(details.email))
    expect(sent.filter((t) => t === 'onboarding.thank-you')).toHaveLength(1)
    expect(sent).not.toContain('onboarding.denied')
    const queue = await staffQueue()
    expect(queue.find((a) => a.memberId === memberId)?.primaryLanguage).toBe('german')
  })

  describe('automatic approval after 24 hours', () => {
    const age = (memberId: string, hours: number) => app.pg.query(
      `UPDATE membership_applications SET submitted_at = now() - make_interval(hours => $2) WHERE member_id = $1`, [memberId, hours])

    it('approves a German application submitted 25 hours ago, mails the approval, and is idempotent', async () => {
      const { details, memberId } = await submitApplication(app, sms, applicant())
      await age(memberId, 25)
      expect(await autoApproveDue(app)).toBe(1)
      expect(await application(memberId)).toMatchObject({ state: 'approved', decided_automatically: true, reviewed_by: null })
      expect(await mails(String(details.email))).toContain('onboarding.approved')
      // The device is approved as a staff approval would.
      const devices = await app.pg.query(`SELECT state FROM device_approvals WHERE member_id = $1`, [memberId])
      expect(devices.rows).toEqual([{ state: 'approved' }])

      expect(await autoApproveDue(app)).toBe(0)
      expect((await mails(String(details.email))).filter((t) => t === 'onboarding.approved')).toHaveLength(1)
    })

    it('leaves one submitted 23 hours ago', async () => {
      const { memberId } = await submitApplication(app, sms, applicant())
      await age(memberId, 23)
      expect(await autoApproveDue(app)).toBe(0)
      expect((await application(memberId)).state).toBe('pending')
    })

    it('never touches a Non-German or language-less application', async () => {
      const denied = await submitApplication(app, sms, applicant({ primaryLanguage: 'non_german' }))
      await age(denied.memberId, 30)
      const noLanguage = await submitApplication(app, sms, applicant())
      await app.pg.query('UPDATE members SET primary_language = NULL WHERE id = $1', [noLanguage.memberId])
      await age(noLanguage.memberId, 30)
      expect(await autoApproveDue(app)).toBe(0)
      expect((await application(denied.memberId)).state).toBe('denied')
      expect((await application(noLanguage.memberId)).state).toBe('pending')
    })

    it('loses cleanly to a staff decision made first', async () => {
      const { details, memberId } = await submitApplication(app, sms, applicant())
      await age(memberId, 25)
      const admin = await createAdmin(app.pg, { grants: { members: { read: true, status: true } } })
      app.permissions.invalidateAll?.()
      const headers = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
      const denied = await app.inject({
        method: 'POST', url: `/admin/onboarding/applications/${memberId}/deny`, headers, payload: { reason: 'Not a fit' },
      })
      expect(denied.statusCode).toBe(200)
      expect(await autoApproveDue(app)).toBe(0)
      expect(await application(memberId)).toMatchObject({ state: 'denied', decided_automatically: false })
      expect((await mails(String(details.email))).filter((t) => t === 'onboarding.approved')).toHaveLength(0)
    })

    it('is registered as a platform job so staff can stop it', async () => {
      const { rows } = await app.pg.query(`SELECT enabled FROM job_definitions WHERE name = 'onboarding.auto-approve'`)
      expect(rows).toHaveLength(1)
    })
  })
})
