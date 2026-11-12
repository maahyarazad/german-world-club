import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify, counts, applicant, register } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Registration completes at mobile verification (FR-007, research R1). An
 * account whose number was typed but never proven earns its referrer nothing —
 * otherwise anyone could earn XP by typing phone numbers they do not own.
 */
describe.skipIf(!hasDatabase)('unverified registrations', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  it('records nothing for a registration whose mobile is never verified', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    await registerAndVerify(app, sms, { referralCode: link.code, verify: false })
    expect(await counts(app)).toEqual({ referrals: 0, awards: 0 })
  })

  it('records the referral once the same applicant verifies', async () => {
    // Counter-assertion: the empty result above is about verification, not the code.
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    expect(await counts(app, memberId!)).toEqual({ referrals: 1, awards: 1 })
  })

  it('credits the code entered last when a stalled application is resumed', async () => {
    const first = await memberOwner(app)
    const second = await memberOwner(app)
    const [a, b] = [(await linkOf(app, first)).link.code, (await linkOf(app, second)).link.code]
    const details = applicant()

    // Registered with one code, never verified; then resumed (same email and
    // password, mobile still unverified) with another.
    await register(app, { ...details, referralCode: a })
    const { memberId } = await registerAndVerify(app, sms, { referralCode: b, details })

    const { rows } = await app.pg.query('SELECT referrer_id FROM referrals WHERE referee_member_id = $1', [memberId])
    expect(rows).toEqual([{ referrer_id: second.id }])
  })
})
