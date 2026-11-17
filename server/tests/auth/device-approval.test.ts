import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { buildOnboardingApp } from '../onboarding/helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 026 — a phone no longer needs a staff approval, and one member can be
 * signed in on the web and on phones at the same time.
 *
 * (This file used to assert §6.1's per-device staff approval gate: an unknown
 * device was refused, and `device_approvals` was read on every request. That
 * gate is gone, replaced by an SMS code on a phone the member has not used
 * before. What stays true is asserted here too: a status refusal is unchanged,
 * and nothing about one phone is carried across to another.)
 *
 * Each case carries a counter-assertion for a server that did nothing or that
 * did the old thing: the "no second code" case fails against a server that
 * texts every time, and the "both stay valid" case fails against one that
 * still ends the other device's session.
 */
let app: GwcApp
let sms: { mobile: string; code: string }[]
beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
afterAll(async () => { await app.close() })

const PHONE = 'phone-one'
const OTHER = 'phone-two'
const MOBILE = '+971501234567'

describe.skipIf(!hasDatabase)('device sign-in without a staff approval (feature 026)', () => {
  let member: { id: string; email: string }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
    member = await createMember(app.pg, { mobile: MOBILE, mobileVerified: true })
  })

  /** Sign in on a phone, answering the SMS code if one is asked for. */
  const phoneSignIn = async (deviceId: string, extra: Record<string, unknown> = {}) => {
    const first = await signIn(app, member.email, undefined, { deviceId, ...extra })
    if (first.body.outcome !== 'otp_required') return { first, final: first.body }
    const code = sms[sms.length - 1]!.code
    const verified = await app.inject({
      method: 'POST', url: '/auth/verify-otp',
      payload: { challengeId: first.body.challengeId, code, deviceId, ...extra },
    })
    return { first, final: verified.json(), status: verified.statusCode }
  }

  const me = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/auth/me', headers })

  it('sends a code to a phone it has not seen, and writes no approval row', async () => {
    const { first, final } = await phoneSignIn(PHONE)
    expect(first.body.outcome).toBe('otp_required')
    expect(first.body.accessToken).toBeUndefined()
    expect(sms).toHaveLength(1)
    expect(final.accessToken).toBeTruthy()

    const { rows } = await app.pg.query('SELECT 1 FROM device_approvals WHERE member_id = $1', [member.id])
    expect(rows).toHaveLength(0)
  })

  it('then lets the same phone in with the password alone', async () => {
    await phoneSignIn(PHONE)
    sms.length = 0
    const { body } = await signIn(app, member.email, undefined, { deviceId: PHONE })
    expect(body.outcome).toBe('authenticated')
    expect(body.accessToken).toBeTruthy()
    // Counter-assertion: a server that texts on every sign-in fails here.
    expect(sms).toHaveLength(0)
  })

  it('keeps the phone known after a plain sign-out', async () => {
    const { final } = await phoneSignIn(PHONE)
    const out = await app.inject({
      method: 'POST', url: '/auth/sign-out', headers: { authorization: `Bearer ${final.accessToken}` },
    })
    expect(out.statusCode).toBe(204)
    sms.length = 0
    const { body } = await signIn(app, member.email, undefined, { deviceId: PHONE })
    expect(body.outcome).toBe('authenticated')
    expect(sms).toHaveLength(0)
  })

  it('does not carry a known phone over to a second phone', async () => {
    await phoneSignIn(PHONE)
    sms.length = 0
    const { body } = await signIn(app, member.email, undefined, { deviceId: OTHER })
    expect(body.outcome).toBe('otp_required')
    expect(body.accessToken).toBeUndefined()
    expect(sms).toHaveLength(1)
  })

  it('is not blocked by a pending or denied approval record', async () => {
    await app.pg.query(
      `INSERT INTO device_approvals (member_id, device_id, state, denial_reason) VALUES
         ($1, 'waiting', 'pending', NULL), ($1, 'refused', 'denied', 'not recognised')`,
      [member.id],
    )
    for (const deviceId of ['waiting', 'refused']) {
      const { final } = await phoneSignIn(deviceId)
      expect(final.accessToken, deviceId).toBeTruthy()
    }
    // ...and neither record made the phone known without the code.
    const { rows } = await app.pg.query(
      `SELECT device_key FROM member_devices WHERE member_id = $1 AND known_at IS NOT NULL ORDER BY device_key`,
      [member.id],
    )
    expect(rows.map((r) => r.device_key)).toEqual(['refused', 'waiting'])
    expect(sms).toHaveLength(2)
  })

  it('forgets the phone when the member is locked and then restored', async () => {
    await phoneSignIn(PHONE)
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [member.id])
    await app.pg.query(`UPDATE members SET status = 'active' WHERE id = $1`, [member.id])
    sms.length = 0
    const { body } = await signIn(app, member.email, undefined, { deviceId: PHONE })
    expect(body.outcome).toBe('otp_required')
    expect(sms).toHaveLength(1)
  })

  it('still refuses a locked member on a phone it knows, exactly as before', async () => {
    await phoneSignIn(PHONE)
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [member.id])
    const { statusCode, body } = await signIn(app, member.email, undefined, { deviceId: PHONE })
    expect(statusCode).toBe(403)
    expect(body.accessToken).toBeUndefined()
  })

  it('lets a member with no verified mobile in on any phone, as the web does', async () => {
    const bare = await createMember(app.pg)
    const { body } = await signIn(app, bare.email, undefined, { deviceId: 'any-phone' })
    expect(body.outcome).toBe('authenticated')
    expect(sms).toHaveLength(0)
  })

  describe('web and phone together', () => {
    const webSignIn = () => signIn(app, member.email)
    const cookieHeader = (cookies: { name: string; value: string }[]) =>
      cookies.map((c) => `${c.name}=${c.value}`).join('; ')

    it('keeps both valid when the phone signs in after the web', async () => {
      const web = await webSignIn()
      const { final } = await phoneSignIn(PHONE)
      const phoneHeaders = { authorization: `Bearer ${final.accessToken}` }
      expect((await me(phoneHeaders)).statusCode).toBe(200)
      expect((await me({ cookie: cookieHeader(web.cookies) })).statusCode).toBe(200)
    })

    it('keeps both valid when the web signs in after the phone', async () => {
      const { final } = await phoneSignIn(PHONE)
      const web = await webSignIn()
      expect((await me({ cookie: cookieHeader(web.cookies) })).statusCode).toBe(200)
      // Counter-assertion: a server that ended the other face's session fails here.
      expect((await me({ authorization: `Bearer ${final.accessToken}` })).statusCode).toBe(200)
    })
  })
})
