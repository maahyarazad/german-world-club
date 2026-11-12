import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { resetAuthTables, createAdmin } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, linkOf, registerAndVerify } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * US3: a referral's stage follows the referee through onboarding, computed
 * from onboarding's own rows (research R14). XP is earned at registration and
 * never moves with the stage (FR-010).
 */
describe.skipIf(!hasDatabase)('referral stages', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  async function referred() {
    const owner = await memberOwner(app)
    const { link } = await linkOf(app, owner)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    // Submitted, as confirming the email would: only submitted applications are decided.
    await app.pg.query('UPDATE membership_applications SET submitted_at = now() WHERE member_id = $1', [memberId])
    const list = async () => {
      const response = await app.inject({ method: 'GET', url: `${owner.prefix}/referrals`, headers: owner.headers })
      expect(response.statusCode).toBe(200)
      return response.json().items as Array<Record<string, unknown>>
    }
    const entries = async () => {
      const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM xp_entries WHERE owner_id = $1', [owner.id])
      return rows[0].n as number
    }
    return { owner, memberId: memberId!, list, entries }
  }

  it('starts as registered, with only the registration date', async () => {
    // Counter-assertion for the transitions below: a fresh referral is not already further along.
    const { list } = await referred()
    const [item] = await list()
    expect(item).toMatchObject({ stage: 'registered', approvedAt: null, joinedAt: null, endedAt: null, xpAwarded: 100 })
    expect(typeof item!.registeredAt).toBe('string')
  })

  it('moves to approved, then joined, without adding XP', async () => {
    const { memberId, list, entries } = await referred()
    await app.pg.query(
      `UPDATE membership_applications SET state = 'approved', reviewed_at = now() WHERE member_id = $1`, [memberId],
    )
    expect((await list())[0]).toMatchObject({ stage: 'approved', joinedAt: null })
    expect(typeof (await list())[0]!.approvedAt).toBe('string')

    await app.pg.query(
      `INSERT INTO member_profiling (member_id, branch, completed_at) VALUES ($1, 'germany', now())`, [memberId],
    )
    expect((await list())[0]).toMatchObject({ stage: 'joined' })
    expect(await entries()).toBe(1)
  })

  it('shows a denial as did_not_join, with a date and no reason, and keeps the XP', async () => {
    const { memberId, list, entries } = await referred()
    const admin = await createAdmin(app.pg)
    await app.pg.query(
      `UPDATE membership_applications SET state = 'denied', denial_reason = 'Secret reason text', reviewed_by = $2, reviewed_at = now()
        WHERE member_id = $1`,
      [memberId, admin.id],
    )
    const [item] = await list()
    expect(item).toMatchObject({ stage: 'did_not_join', xpAwarded: 100 })
    expect(typeof item!.endedAt).toBe('string')
    expect(JSON.stringify(item)).not.toContain('Secret reason text')
    expect(await entries()).toBe(1)
  })
})
