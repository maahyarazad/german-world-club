import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { buildOnboardingApp } from '../onboarding/helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 027, US2 — one member on several phones and a browser at once.
 *
 * 026 made this possible; this file proves it with more than two devices and no
 * cap, because "it works for a phone and a browser" does not show that nothing
 * is counting. Counter-assertion throughout: against a server that kept one
 * session per account (or one per kind of face), the very first `/auth/me`
 * below fails.
 */
let app: GwcApp
let sms: { mobile: string; code: string }[]
beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
afterAll(async () => { await app.close() })

const MOBILE = '+971501234567'
const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

describe.skipIf(!hasDatabase)('several devices at once (feature 027)', () => {
  let member: { id: string; email: string }
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
    member = await createMember(app.pg, { mobile: MOBILE, mobileVerified: true })
  })

  const phoneSignIn = async (deviceId: string, deviceLabel = `Phone ${deviceId}`) => {
    const first = await signIn(app, member.email, undefined, { deviceId, deviceLabel })
    if (first.body.outcome !== 'otp_required') return first.body
    const verified = await app.inject({
      method: 'POST', url: '/auth/verify-otp',
      payload: { challengeId: first.body.challengeId, code: sms[sms.length - 1]!.code, deviceId, deviceLabel },
    })
    return verified.json()
  }
  const bearer = (t: { accessToken: string }) => ({ authorization: `Bearer ${t.accessToken}` })
  const me = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/auth/me', headers })
  const list = async (headers: Record<string, string>) =>
    (await app.inject({ method: 'GET', url: '/member/devices', headers })).json().devices as
      Array<{ id: string; kind: string; label: string; current: boolean }>

  it('keeps three phones and a browser signed in together, lists all four, and ends one without touching the rest', async () => {
    const a = await phoneSignIn('phone-a')
    const b = await phoneSignIn('phone-b')
    const c = await phoneSignIn('phone-c')
    const web = await signIn(app, member.email, undefined, {}, { 'user-agent': WEB_UA })
    const webHeaders = { cookie: web.cookies.map((k: { name: string; value: string }) => `${k.name}=${k.value}`).join('; ') }

    for (const headers of [bearer(a), bearer(b), bearer(c), webHeaders]) {
      expect((await me(headers)).statusCode).toBe(200)
    }

    const devices = await list(bearer(a))
    expect(devices).toHaveLength(4)
    expect(devices.map((d) => d.label).sort()).toEqual(['Chrome on macOS', 'Phone phone-a', 'Phone phone-b', 'Phone phone-c'])
    expect(devices.filter((d) => d.current).map((d) => d.label)).toEqual(['Phone phone-a'])

    const target = devices.find((d) => d.label === 'Phone phone-b')!
    expect((await app.inject({ method: 'DELETE', url: `/member/devices/${target.id}`, headers: bearer(a) })).statusCode).toBe(204)

    expect((await me(bearer(b))).statusCode).toBe(401)
    for (const headers of [bearer(a), bearer(c), webHeaders]) {
      expect((await me(headers)).statusCode).toBe(200)
    }

    // No cap: a fourth phone signs in and evicts nobody.
    const d = await phoneSignIn('phone-d')
    for (const headers of [bearer(a), bearer(c), bearer(d), webHeaders]) {
      expect((await me(headers)).statusCode).toBe(200)
    }
    expect(await list(bearer(a))).toHaveLength(4)
  })

  it('keeps one entry for a phone that signs in twice, and two entries for two phones with the same model name', async () => {
    const first = await phoneSignIn('phone-a', 'iPhone 15')
    await phoneSignIn('phone-a', 'iPhone 15') // same phone, known now: password alone
    await phoneSignIn('phone-b', 'iPhone 15')

    const { rows } = await app.pg.query(
      'SELECT device_key, label FROM member_devices WHERE member_id = $1 ORDER BY device_key', [member.id])
    expect(rows).toEqual([
      { device_key: 'phone-a', label: 'iPhone 15' },
      { device_key: 'phone-b', label: 'iPhone 15' },
    ])
    // The first session of phone-a was replaced by its own second sign-in...
    expect((await me(bearer(first))).statusCode).toBe(401)
    // ...and exactly two sessions are active: one per phone, never one per label.
    const { rows: active } = await app.pg.query(
      `SELECT count(*)::int AS n FROM sessions WHERE account_id = $1 AND revoked_at IS NULL`, [member.id])
    expect(active[0].n).toBe(2)
  })
})
