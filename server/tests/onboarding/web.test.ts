import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { COOKIES } from '@gwc/contracts/auth'
import { PROBLEMS } from '@gwc/contracts/errors'
import { resetAuthTables, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, applicant, emailCodeFor, register } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The same onboarding, on the web face.
 *
 * What differs from the app is only how the session travels and what approval
 * binds to: no deviceId anywhere, the session arrives as httpOnly cookies (the
 * page never sees a token), every write carries a CSRF token, and approving
 * approves the member — there is no device to approve.
 */
describe.skipIf(!hasDatabase)('onboarding on the web face', () => {
  let app: GwcApp
  let sms: { mobile: string; code: string }[]

  beforeAll(async () => { ({ app, sms } = await buildOnboardingApp()) })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
  })

  type Jar = Record<string, string>

  /** What a browser holds: the cookies it was given, plus a CSRF pair. */
  async function browser(jar: Jar = {}) {
    const csrf = await app.inject({ method: 'GET', url: '/auth/csrf', cookies: jar })
    const csrfCookie = csrf.cookies.find((c) => c.name === COOKIES.csrf)!
    return {
      jar: { ...jar, [COOKIES.csrf]: csrfCookie.value },
      token: csrf.json().csrfToken as string,
    }
  }

  const call = async (jar: Jar, method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) => {
    const b = await browser(jar)
    return app.inject({
      method, url, cookies: b.jar, payload: payload as never,
      headers: method === 'POST' ? { 'x-csrf-token': b.token } : {},
    })
  }

  const cookieJar = (response: { cookies: { name: string; value: string }[] }): Jar =>
    Object.fromEntries(response.cookies.map((c) => [c.name, c.value]))

  /** Register and verify the mobile number, as the console does. Returns the cookie jar. */
  async function registerOnWeb(details = applicant({ deviceId: undefined })) {
    const { challengeId } = (await register(app, details)).json()
    const verified = await call({}, 'POST', '/onboarding/verify-mobile', { challengeId, code: sms[sms.length - 1]!.code })
    return { details, verified, jar: cookieJar(verified) }
  }

  async function submitOnWeb() {
    const { details, jar } = await registerOnWeb()
    const sent = (await call(jar, 'POST', '/onboarding/email/send')).json()
    const code = await emailCodeFor(app, details.email)
    const confirmed = await call(jar, 'POST', '/onboarding/email/verify', { challengeId: sent.challengeId, code })
    const { rows } = await app.pg.query('SELECT id FROM members WHERE email = $1', [details.email])
    return { details, jar, status: confirmed.json(), memberId: String(rows[0].id) }
  }

  it('records a web application with no device', async () => {
    const details = applicant({ deviceId: undefined })
    expect((await register(app, details)).statusCode).toBe(202)
    const { rows } = await app.pg.query(
      `SELECT a.device_id FROM membership_applications a JOIN members m ON m.id = a.member_id WHERE m.email = $1`,
      [details.email],
    )
    expect(rows).toEqual([{ device_id: null }])
  })

  it('opens the session as httpOnly cookies and never puts a token in the body', async () => {
    const { verified } = await registerOnWeb()
    expect(verified.statusCode).toBe(200)
    expect(verified.json().accessToken).toBeUndefined()
    expect(verified.json().refreshToken).toBeUndefined()
    expect(verified.json().principal.kind).toBe('member')

    const access = verified.cookies.find((c) => c.name === COOKIES.access)
    expect(access?.httpOnly).toBe(true)
    expect(verified.cookies.map((c) => c.name)).toContain(COOKIES.refresh)
  })

  it('walks to "awaiting approval" on cookies alone', async () => {
    const { status } = await submitOnWeb()
    expect(status.step).toBe('awaiting_approval')
  })

  it('refuses a cookie write with no CSRF token — the web face is not exempt', async () => {
    const { jar } = await registerOnWeb()
    const response = await app.inject({ method: 'POST', url: '/onboarding/email/send', cookies: jar })
    expect(response.statusCode).toBe(403)
    expect(response.json().type).toBe(PROBLEMS.CSRF_TOKEN_INVALID.type)
  })

  it('keeps the applicant out of the portal, and tells the console why', async () => {
    const { jar } = await submitOnWeb()
    const me = await call(jar, 'GET', '/auth/me')
    expect(me.statusCode).toBe(403)
    expect(me.json().type).toBe(PROBLEMS.APPROVAL_PENDING.type)
    // Counter-assertion: the same cookies still reach onboarding.
    expect((await call(jar, 'GET', '/onboarding/status')).statusCode).toBe(200)
  })

  it('resumes a web application by password on the web, and nowhere else', async () => {
    const { details } = await submitOnWeb()
    const web = await app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email: details.email, password: details.password } })
    expect(web.json().outcome).toBe('authenticated')
    expect(web.json().accessToken).toBeUndefined()
    const status = await call(cookieJar(web), 'GET', '/onboarding/status')
    expect(status.json().step).toBe('awaiting_approval')

    // The same account in the app gets no session: it applied on the web.
    const phone = await app.inject({
      method: 'POST', url: '/auth/sign-in', payload: { email: details.email, password: details.password, deviceId: 'some-phone' },
    })
    expect(phone.json().outcome).toBe('approval_pending')
  })

  it('lets an applicant sign out', async () => {
    const { jar } = await submitOnWeb()
    expect((await call(jar, 'POST', '/auth/sign-out')).statusCode).toBe(204)
    expect((await call(jar, 'GET', '/onboarding/status')).statusCode).toBeGreaterThanOrEqual(401)
  })

  it('approval opens the portal and approves no device', async () => {
    const { jar, memberId } = await submitOnWeb()
    const admin = await createAdmin(app.pg, { grants: { members: { read: true, status: true } } })
    const staff = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })

    const approved = await app.inject({ method: 'POST', url: `/admin/onboarding/applications/${memberId}/approve`, headers: staff })
    expect(approved.json()).toMatchObject({ state: 'approved', deviceId: null })

    expect((await call(jar, 'GET', '/auth/me')).statusCode).toBe(200)
    const { rows } = await app.pg.query('SELECT 1 FROM device_approvals WHERE member_id = $1', [memberId])
    expect(rows).toHaveLength(0)
  })
})
