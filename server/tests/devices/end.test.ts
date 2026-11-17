import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { buildOnboardingApp } from '../onboarding/helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 026, US3 — ending a device from the list.
 *
 * Every case has its counter-assertion: the ended device is refused AND the one
 * that did the ending is not; a forgotten phone needs a code AND a phone that
 * merely signed out does not; another member's id and an unknown id are
 * indistinguishable.
 */
let app: GwcApp
let sms: { mobile: string; code: string }[]
beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
afterAll(async () => { await app.close() })

const MOBILE = '+971501234567'

describe.skipIf(!hasDatabase)('DELETE /member/devices/:id', () => {
  let member: { id: string; email: string }
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
    member = await createMember(app.pg, { mobile: MOBILE, mobileVerified: true })
  })

  const phoneSignIn = async (deviceId: string) => {
    const first = await signIn(app, member.email, undefined, { deviceId, deviceLabel: `Phone ${deviceId}` })
    if (first.body.outcome !== 'otp_required') return first.body
    const verified = await app.inject({
      method: 'POST', url: '/auth/verify-otp',
      payload: { challengeId: first.body.challengeId, code: sms[sms.length - 1]!.code, deviceId, deviceLabel: `Phone ${deviceId}` },
    })
    return verified.json()
  }
  const bearer = (tokens: { accessToken: string }) => ({ authorization: `Bearer ${tokens.accessToken}` })
  const list = async (headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/member/devices', headers })).json().devices as
      Array<{ id: string; label: string; current: boolean }>
  const me = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/auth/me', headers })
  const end = (headers: Record<string, string>, id: string) =>
    app.inject({ method: 'DELETE', url: `/member/devices/${id}`, headers })

  it('refuses the ended phone at once, while the one that ended it keeps working', async () => {
    const a = await phoneSignIn('phone-a')
    const b = await phoneSignIn('phone-b')
    const target = (await list(bearer(a))).find((d) => d.label === 'Phone phone-b')!

    expect((await end(bearer(a), target.id)).statusCode).toBe(204)

    expect((await me(bearer(b))).statusCode).toBe(401)
    expect((await me(bearer(a))).statusCode).toBe(200)
    // Its refresh token is dead too, so it cannot quietly mint a new access token.
    const refreshed = await app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: b.refreshToken } })
    expect(refreshed.statusCode).toBeGreaterThanOrEqual(400)
    expect((await list(bearer(a))).map((d) => d.label)).toEqual(['Phone phone-a'])
  })

  it('forgets an ended phone, so its next sign-in needs the SMS code again', async () => {
    const a = await phoneSignIn('phone-a')
    await phoneSignIn('phone-b')
    const target = (await list(bearer(a))).find((d) => d.label === 'Phone phone-b')!
    await end(bearer(a), target.id)

    sms.length = 0
    const again = await signIn(app, member.email, undefined, { deviceId: 'phone-b' })
    expect(again.body.outcome).toBe('otp_required')
    expect(again.body.accessToken).toBeUndefined()
    expect(sms).toHaveLength(1)
  })

  it('keeps a phone known when it signs itself out, which is not the same thing', async () => {
    const a = await phoneSignIn('phone-a')
    await app.inject({ method: 'POST', url: '/auth/sign-out', headers: bearer(a) })
    sms.length = 0
    const again = await signIn(app, member.email, undefined, { deviceId: 'phone-a' })
    expect(again.body.outcome).toBe('authenticated')
    expect(sms).toHaveLength(0)
  })

  it('treats ending the current device as a sign-out, which keeps the phone known', async () => {
    const a = await phoneSignIn('phone-a')
    const current = (await list(bearer(a))).find((d) => d.current)!
    expect((await end(bearer(a), current.id)).statusCode).toBe(204)
    expect((await me(bearer(a))).statusCode).toBe(401)

    sms.length = 0
    const again = await signIn(app, member.email, undefined, { deviceId: 'phone-a' })
    expect(again.body.outcome).toBe('authenticated')
    expect(sms).toHaveLength(0)
  })

  it('is idempotent for a device the member already ended', async () => {
    const a = await phoneSignIn('phone-a')
    await phoneSignIn('phone-b')
    const target = (await list(bearer(a))).find((d) => d.label === 'Phone phone-b')!
    expect((await end(bearer(a), target.id)).statusCode).toBe(204)
    expect((await end(bearer(a), target.id)).statusCode).toBe(204)
  })

  it("answers another member's device exactly like one that does not exist", async () => {
    const other = await createMember(app.pg)
    const theirs = await signIn(app, other.email, undefined, { deviceId: 'their-phone' })
    const theirList = await list(bearer(theirs.body))
    const mine = await phoneSignIn('phone-a')

    const foreign = await end(bearer(mine), theirList[0]!.id)
    const unknown = await end(bearer(mine), '00000000-0000-4000-8000-000000000000')
    expect(foreign.statusCode).toBe(404)
    expect(unknown.statusCode).toBe(404)
    // `instance` echoes the path the caller asked for and `requestId` is per
    // request; everything else — type, title, status, detail — must be identical.
    const shape = (r: { json: () => Record<string, unknown> }) => {
      const { instance: _i, requestId: _r, ...rest } = r.json()
      return rest
    }
    expect(shape(foreign)).toEqual(shape(unknown))
    // Headers match too, apart from the ones that are per request by design: the
    // date, request id and length, the CSP nonce, the ETag (a hash of a body that
    // echoes the path) and the rate-limit counter.
    const PER_REQUEST = ['date', 'x-request-id', 'content-length', 'content-security-policy', 'etag', 'ratelimit-remaining']
    const strip = (h: Record<string, unknown>) =>
      Object.fromEntries(Object.entries(h).filter(([k]) => !PER_REQUEST.includes(k)))
    expect(strip(foreign.headers)).toEqual(strip(unknown.headers))

    // ...and nothing happened to their device.
    expect((await me(bearer(theirs.body))).statusCode).toBe(200)
  })

  it('removes the ended session\'s push registration', async () => {
    const a = await phoneSignIn('phone-a')
    const b = await phoneSignIn('phone-b')
    const { rows: sessions } = await app.pg.query(
      `SELECT s.id FROM sessions s JOIN member_devices d ON d.id = s.member_device_id
        WHERE d.device_key = 'phone-b' AND s.revoked_at IS NULL`)
    await app.pg.query(
      `INSERT INTO push_devices (member_id, token, provider, platform, locale, enabled, session_id)
       VALUES ($1, 'ExponentPushToken[b]', 'expo', 'ios', 'de', true, $2)`, [member.id, sessions[0].id])
    const target = (await list(bearer(a))).find((d) => d.label === 'Phone phone-b')!
    await end(bearer(a), target.id)
    const { rows } = await app.pg.query('SELECT 1 FROM push_devices WHERE member_id = $1', [member.id])
    expect(rows).toHaveLength(0)
    expect(b.accessToken).toBeTruthy()
  })

  it('writes an audit entry for the end, and for a refused probe', async () => {
    const a = await phoneSignIn('phone-a')
    await phoneSignIn('phone-b')
    const target = (await list(bearer(a))).find((d) => d.label === 'Phone phone-b')!
    await end(bearer(a), target.id)
    await end(bearer(a), '00000000-0000-4000-8000-000000000000')
    const { rows } = await app.pg.query(
      `SELECT action, outcome FROM audit_log WHERE actor_id = $1 AND action IN ('device_ended', 'device_end_refused') ORDER BY occurred_at`,
      [member.id])
    expect(rows).toEqual([
      { action: 'device_ended', outcome: 'allowed' },
      { action: 'device_end_refused', outcome: 'denied' },
    ])
  })
})
