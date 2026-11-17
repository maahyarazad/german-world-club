import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, bearerFor, createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 026, US2 — the member's own device list (contracts/devices-api.md).
 *
 * Besides what it shows, the list is tested for what it must NOT show: it is
 * the one response in the platform built from the table that holds a device key
 * and the known-phone marker.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const WEB_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

describe.skipIf(!hasDatabase)('GET /member/devices', () => {
  let member: { id: string; email: string }
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
  })

  const webSignIn = (email = member.email) => signIn(app, email, undefined, {}, { 'user-agent': WEB_UA })
  const phoneSignIn = async (deviceId: string, deviceLabel = 'iPhone 15', email = member.email) => {
    const { body } = await signIn(app, email, undefined, { deviceId, deviceLabel })
    return { authorization: `Bearer ${body.accessToken}` }
  }
  const cookieOf = (cookies: { name: string; value: string }[]) => cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  const list = (headers: Record<string, string>) => app.inject({ method: 'GET', url: '/member/devices', headers })

  it('lists the web browser and the phone, marking the one asking', async () => {
    const web = await webSignIn()
    const phone = await phoneSignIn('phone-one')

    const fromPhone = (await list(phone)).json()
    expect(fromPhone.devices).toHaveLength(2)
    expect(fromPhone.devices.find((d: { current: boolean }) => d.current)).toMatchObject({ kind: 'mobile', label: 'iPhone 15' })
    expect(fromPhone.devices.find((d: { current: boolean }) => !d.current)).toMatchObject({ kind: 'web', label: 'Chrome on macOS' })

    const fromWeb = (await list({ cookie: cookieOf(web.cookies) })).json()
    expect(fromWeb.devices.find((d: { current: boolean }) => d.current)).toMatchObject({ kind: 'web' })
  })

  it('shows exactly the documented fields and nothing that identifies or could replay a device', async () => {
    await webSignIn()
    const phone = await phoneSignIn('very-secret-device-id')
    const response = await list(phone)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')

    for (const d of response.json().devices) {
      expect(Object.keys(d).sort()).toEqual(['current', 'firstSeenAt', 'id', 'kind', 'label', 'lastSeenAt'])
    }
    const text = response.body
    expect(text).not.toContain('very-secret-device-id')
    for (const forbidden of ['userAgent', 'user_agent', 'deviceKey', 'device_key', 'known', 'ip', 'token', 'sid', 'Mozilla']) {
      expect(text, forbidden).not.toContain(forbidden)
    }
  })

  it('does not list a device that has signed out', async () => {
    const phone = await phoneSignIn('phone-one')
    const web = await webSignIn()
    await app.inject({ method: 'POST', url: '/auth/sign-out', headers: phone })
    const devices = (await list({ cookie: cookieOf(web.cookies) })).json().devices
    expect(devices).toHaveLength(1)
    expect(devices[0].kind).toBe('web')
  })

  it("never shows another member's devices", async () => {
    const other = await createMember(app.pg)
    await phoneSignIn('their-phone', 'Their Pixel', other.email)
    const mine = await phoneSignIn('my-phone', 'My iPhone')
    const devices = (await list(mine)).json().devices
    expect(devices).toHaveLength(1)
    expect(devices[0].label).toBe('My iPhone')
  })

  it('refuses a request with no credentials, and an applicant like every other member route', async () => {
    expect((await app.inject({ method: 'GET', url: '/member/devices' })).statusCode).toBe(401)

    const applicant = await createMember(app.pg)
    await app.pg.query(
      `INSERT INTO membership_applications (member_id, device_id, state, submitted_at) VALUES ($1, 'x', 'pending', now())`,
      [applicant.id],
    )
    const headers = await bearerFor(app, { accountId: applicant.id, accountKind: 'member' })
    const refused = await list({ authorization: headers.authorization })
    expect(refused.statusCode).toBe(403)
  })
})
