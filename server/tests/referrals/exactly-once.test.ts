import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { withTransaction } from '../../src/db/query.ts'
import { recordReferral } from '../../src/modules/referrals/application/attribution.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify, counts } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-003: a referral earns XP exactly once, however many times and however
 * concurrently the step that records it runs. Asserted as `= 1`, not `>= 1`.
 */
describe.skipIf(!hasDatabase)('exactly once', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  it('records one referral and one award when the verification is sent ten times at once', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { challengeId, details } = await registerAndVerify(app, sms, { referralCode: link.code, verify: false })
    const code = sms.filter((s) => s.mobile === details.mobile).at(-1)!.code

    const responses = await Promise.all(Array.from({ length: 10 }, () => app.inject({
      method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code, deviceId: details.deviceId },
    })))
    expect(responses.some((r) => r.statusCode === 200)).toBe(true)
    expect(await counts(app)).toEqual({ referrals: 1, awards: 1 })
  })

  it('records one referral and one award when the recording step itself races', async () => {
    // Below the HTTP layer: ten transactions that each believe they are first.
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code, verify: false })
      .then(async (r) => {
        const { rows } = await app.pg.query('SELECT id FROM members WHERE email = $1', [r.details.email])
        return { memberId: String(rows[0].id) }
      })

    await Promise.all(Array.from({ length: 10 }, () =>
      withTransaction(app.pg, (client) => recordReferral(client, memberId))))

    expect(await counts(app, memberId)).toEqual({ referrals: 1, awards: 1 })
  })

  it('refuses a second award for one referral in the database itself', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    await expect(app.pg.query(
      `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason)
       SELECT r.referrer_kind, r.referrer_id, 'award', 100, r.id,
              (SELECT id FROM referral_xp_rates LIMIT 1), 'referral'
         FROM referrals r WHERE r.referee_member_id = $1`,
      [memberId],
    )).rejects.toThrow(/xp_entries_one_award_per_referral/)
  })
})
