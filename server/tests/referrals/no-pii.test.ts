import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables, createAdmin } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify, applicant } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-018 / research R15: a referrer learns who joined through their link by
 * name only. Nothing else about the referee — contact details, birthday,
 * country, why an application was denied — reaches any referral response.
 */
describe.skipIf(!hasDatabase)('referral responses carry no referee PII', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  it('shows "First L." and nothing identifying', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const details = applicant({ fullName: 'Petra Privat', birthday: '1987-03-21', countryOfResidence: 'AT' })
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code, details })
    const admin = await createAdmin(app.pg)
    await app.pg.query(
      `UPDATE membership_applications SET submitted_at = now(), state = 'denied',
              denial_reason = 'Confidential denial reason', reviewed_by = $2, reviewed_at = now()
        WHERE member_id = $1`,
      [memberId, admin.id],
    )

    const bodies = []
    for (const path of ['', '/referrals', '/xp']) {
      const response = await app.inject({ method: 'GET', url: `${owner.prefix}${path}`, headers: owner.headers })
      expect(response.statusCode).toBe(200)
      bodies.push(response.body)
    }
    const all = bodies.join('\n')

    // Counter-assertion: the referee IS in the response — by the name a referrer may see.
    expect(all).toContain('Petra P.')
    for (const secret of [
      String(details.email), String(details.mobile), String(details.mobile).slice(-6),
      'Privat', '1987-03-21', '"AT"', 'Confidential denial reason', memberId!,
    ]) {
      expect(all).not.toContain(secret)
    }
  })

  it('prefers the handle when the referee has one', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    await app.pg.query(`UPDATE members SET handle = 'petra_p' WHERE id = $1`, [memberId])
    const response = await app.inject({ method: 'GET', url: `${owner.prefix}/referrals`, headers: owner.headers })
    expect(response.json().items[0].refereeName).toBe('@petra_p')
  })
})
