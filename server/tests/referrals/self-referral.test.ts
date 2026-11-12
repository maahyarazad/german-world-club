import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, orgOwner, staffOwner, linkOf, registerAndVerify, counts, applicant } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-008 / research R3: a person cannot refer themselves. Staff and
 * organisation users live in other tables than members, so registering a
 * member account with their own email address is possible — and earns them
 * nothing. Refused silently: the applicant sees an ordinary registration.
 */
describe.skipIf(!hasDatabase)('self-referral', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  for (const make of [staffOwner, (a: GwcApp) => orgOwner(a, 'partner')]) {
    it(`credits nobody when the applicant uses the owner's own email (${make === staffOwner ? 'staff' : 'partner'})`, async () => {
      const owner = await make(app)
      const { link } = await linkOf(app, owner)
      const { registered, memberId } = await registerAndVerify(app, sms, {
        referralCode: link.code, details: applicant({ email: owner.email }),
      })

      expect(registered.statusCode).toBe(202)
      expect(await counts(app, memberId!)).toEqual({ referrals: 0, awards: 0 })
      const { rows } = await app.pg.query(
        `SELECT detail->>'reason' AS reason FROM audit_log WHERE action = 'referral_refused' AND target_id = $1`,
        [memberId],
      )
      expect(rows).toEqual([{ reason: 'self-referral' }])
    })
  }

  it('credits the owner when the applicant is somebody else', async () => {
    // Counter-assertion: the refusals above are about the address, not the owner kind.
    const owner = await staffOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    expect(await counts(app, memberId!)).toEqual({ referrals: 1, awards: 1 })
  })
})
