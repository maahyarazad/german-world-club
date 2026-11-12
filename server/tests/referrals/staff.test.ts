import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { resetAuthTables, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildReferralApp, memberOwner, staffOwner, linkOf, registerAndVerify } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * US4: staff oversight on the `referrals` module (research R12).
 *   read   — see anyone's link, referrals and XP
 *   status — disable a link, reverse an award (a reason each, audited)
 *   edit   — change the XP rate (a reason, audited)
 * Never on one's own records: staff earn XP too (spec Q2).
 */
describe.skipIf(!hasDatabase)('staff oversight of referrals', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildReferralApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  async function staffWith(flags: Record<string, boolean> | true) {
    const admin = await createAdmin(app.pg, { isAdmin: false, grants: { referrals: flags } as never })
    const { authorization } = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
    return { id: String(admin.id), headers: { authorization } }
  }

  /** A member with one awarded referral; returns the award's id and the link id. */
  async function awarded(owner?: Awaited<ReturnType<typeof memberOwner>>) {
    const o = owner ?? await memberOwner(app)
    const { link } = await linkOf(app, o)
    const { memberId } = await registerAndVerify(app, sms, { referralCode: link.code })
    const { rows: [e] } = await app.pg.query(
      `SELECT e.id, r.link_id FROM xp_entries e JOIN referrals r ON r.id = e.referral_id WHERE r.referee_member_id = $1`,
      [memberId],
    )
    return { owner: o, entryId: String(e.id), linkId: String(e.link_id), code: link.code }
  }

  const reverse = (headers: Record<string, string>, entryId: string, reason = 'fake account ring') =>
    app.inject({ method: 'POST', url: `/admin/referrals/xp/${entryId}/reverse`, headers, payload: { reason } })
  const disable = (headers: Record<string, string>, linkId: string, reason = 'abuse') =>
    app.inject({ method: 'POST', url: `/admin/referrals/links/${linkId}/disable`, headers, payload: { reason } })

  it('reverses an award once: a matching negative entry, the original untouched, audited with the reason', async () => {
    const { owner, entryId } = await awarded()
    const staff = await staffWith({ read: true, status: true })

    const first = await reverse(staff.headers, entryId)
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ kind: 'reversal', amount: -100, reversesEntryId: entryId, reason: 'fake account ring' })
    expect((await linkOf(app, owner)).xpBalance).toBe(0)
    const { rows } = await app.pg.query('SELECT amount FROM xp_entries WHERE id = $1', [entryId])
    expect(rows[0].amount).toBe(100)

    const { rows: audit } = await app.pg.query(
      `SELECT actor_id, detail->>'reason' AS reason FROM audit_log WHERE action = 'xp_reversed'`,
    )
    expect(audit).toEqual([{ actor_id: staff.id, reason: 'fake account ring' }])

    const second = await reverse(staff.headers, entryId)
    expect(second.statusCode).toBe(409)
    expect(second.json().type).toBe(PROBLEMS.CONFLICT.type)
    // A reversal is not itself reversible.
    expect((await reverse(staff.headers, first.json().id)).statusCode).toBe(409)
  })

  it('requires a reason', async () => {
    const { entryId } = await awarded()
    const staff = await staffWith({ read: true, status: true })
    expect((await reverse(staff.headers, entryId, '   ')).statusCode).toBe(400)
  })

  it('refuses without the grant, and with read only', async () => {
    const { entryId, linkId } = await awarded()
    const none = await staffOwner(app)
    const reader = await staffWith({ read: true })
    for (const headers of [none.headers, reader.headers]) {
      expect((await reverse(headers, entryId)).statusCode).toBe(403)
      expect((await disable(headers, linkId)).statusCode).toBe(403)
    }
    expect((await app.inject({ method: 'GET', url: '/admin/referrals/owners', headers: none.headers })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/admin/referrals/owners', headers: reader.headers })).statusCode).toBe(200)
  })

  it('refuses a staff member acting on their own link or their own award', async () => {
    const staff = await staffWith(true)
    const self = { id: staff.id, kind: 'admin' as const, headers: staff.headers, prefix: '/admin/referrals/me', email: '' }
    const { entryId, linkId } = await awarded(self)

    for (const response of [await reverse(staff.headers, entryId), await disable(staff.headers, linkId)]) {
      expect(response.statusCode).toBe(403)
      expect(response.json().type).toBe(PROBLEMS.INSUFFICIENT_PERMISSION.type)
    }
  })

  it('lets a superadmin act on somebody else\'s record', async () => {
    // Counter-assertion for the self-refusal: it is about whose record, not about staff XP at all.
    const { entryId } = await awarded()
    const superadmin = await createAdmin(app.pg, { isSuperadmin: true })
    const { authorization } = await bearerFor(app, { accountId: String(superadmin.id), accountKind: 'admin' })
    expect((await reverse({ authorization }, entryId)).statusCode).toBe(200)
  })

  it('disables a link: its page becomes the shared 404, and earlier referrals and XP stay', async () => {
    const { owner, linkId, code } = await awarded()
    const staff = await staffWith({ read: true, status: true })

    expect((await app.inject({ method: 'GET', url: `/r/${code.toLowerCase()}` })).statusCode).toBe(200)
    expect((await disable(staff.headers, linkId)).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: `/r/${code.toLowerCase()}` })).statusCode).toBe(404)
    expect((await disable(staff.headers, linkId)).statusCode).toBe(409)

    const summary = await app.inject({ method: 'GET', url: `/admin/referrals/owners/member/${owner.id}`, headers: staff.headers })
    expect(summary.json()).toMatchObject({ xpBalance: 100, counts: { registered: 1 }, link: { state: 'disabled' } })
  })

  it('changes the rate with edit only, for new referrals only', async () => {
    const { owner } = await awarded()
    const status = await staffWith({ read: true, status: true })
    const editor = await staffWith({ read: true, edit: true })
    const put = (headers: Record<string, string>, payload: unknown) =>
      app.inject({ method: 'PUT', url: '/admin/referrals/xp-rate', headers, payload })

    expect((await put(status.headers, { xp: 150, reason: 'campaign' })).statusCode).toBe(403)
    expect((await put(editor.headers, { xp: 0, reason: 'campaign' })).statusCode).toBe(400)
    const changed = await put(editor.headers, { xp: 150, reason: 'autumn campaign' })
    expect(changed.statusCode).toBe(200)
    expect(changed.json()).toMatchObject({ xp: 150, reason: 'autumn campaign' })

    const rate = await app.inject({ method: 'GET', url: '/admin/referrals/xp-rate', headers: editor.headers })
    expect(rate.json().current.xp).toBe(150)
    expect(rate.json().history.map((r: { xp: number }) => r.xp)).toEqual([150, 100])

    await awarded(owner)
    expect((await linkOf(app, owner)).xpBalance).toBe(250)
  })

  it('lists owners and shows anybody\'s referrals and XP with the same restricted referee fields', async () => {
    const { owner } = await awarded()
    const staff = await staffWith({ read: true })
    const list = await app.inject({ method: 'GET', url: '/admin/referrals/owners?kind=member', headers: staff.headers })
    expect(list.statusCode).toBe(200)
    expect(list.json().items).toEqual([
      expect.objectContaining({ ownerKind: 'member', ownerId: owner.id, name: 'Rita Referrer', xpBalance: 100 }),
    ])
    const referrals = await app.inject({ method: 'GET', url: `/admin/referrals/owners/member/${owner.id}/referrals`, headers: staff.headers })
    expect(referrals.json().items[0]).toMatchObject({ refereeName: 'Anna A.', stage: 'registered' })
    expect(referrals.body).not.toMatch(/@test\.invalid|\+49/)
    const unknown = await app.inject({ method: 'GET', url: '/admin/referrals/owners/member/00000000-0000-4000-8000-000000000000', headers: staff.headers })
    expect(unknown.statusCode).toBe(404)
  })
})
