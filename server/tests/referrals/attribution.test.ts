import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify, counts, applicant } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * US2: a new member who registers through a link is credited to its owner,
 * and the owner earns XP once (FR-007, FR-010, research R1).
 */
describe.skipIf(!hasDatabase)('referral attribution', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  it('records the referral and one award at the current rate when the mobile is verified (app face)', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })

    expect(await counts(app, memberId!)).toEqual({ referrals: 1, awards: 1 })
    const { rows: [entry] } = await app.pg.query(
      `SELECT e.owner_kind, e.owner_id, e.amount, e.rate_id = (SELECT id FROM referral_xp_rates ORDER BY effective_from DESC, id DESC LIMIT 1) AS current_rate
         FROM xp_entries e JOIN referrals r ON r.id = e.referral_id WHERE r.referee_member_id = $1`,
      [memberId],
    )
    expect(entry).toEqual({ owner_kind: 'member', owner_id: owner.id, amount: 100, current_rate: true })
    expect((await linkOf(app, owner)).xpBalance).toBe(100)

    const { rows: actions } = await app.pg.query(
      `SELECT action FROM audit_log WHERE action IN ('referral_recorded', 'xp_awarded') ORDER BY id`,
    )
    expect(actions.map((a) => a.action)).toEqual(['referral_recorded', 'xp_awarded'])
  })

  it('works the same on the web face, which sends no deviceId', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const details = applicant()
    delete (details as Record<string, unknown>).deviceId
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code.toLowerCase(), details })
    expect(await counts(app, memberId!)).toEqual({ referrals: 1, awards: 1 })
  })

  it('accepts the code as people type it: lower case, hyphenated, with confusable letters', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const typed = `${link.code.slice(0, 4)}-${link.code.slice(4)}`.toLowerCase().replace(/1/g, 'l').replace(/0/g, 'o')
    const { memberId } = await registerAndVerify(app, sms, { referralCode: typed })
    expect(await counts(app, memberId!)).toEqual({ referrals: 1, awards: 1 })
  })

  it('credits nobody when there is no code', async () => {
    // Counter-assertion: the rows above come from the code, not from registering.
    const owner = await memberOwner(app)
    await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms)
    expect(await counts(app, memberId!)).toEqual({ referrals: 0, awards: 0 })
    expect((await linkOf(app, owner)).xpBalance).toBe(0)
  })

  it('does not change what the applicant sees', async () => {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const withCode = await registerAndVerify(app, sms, { referralCode: link.code, verify: false })
    const without = await registerAndVerify(app, sms, { verify: false })
    expect(withCode.registered.statusCode).toBe(without.registered.statusCode)
    expect(Object.keys(withCode.registered.json()).sort()).toEqual(Object.keys(without.registered.json()).sort())
  })
})
