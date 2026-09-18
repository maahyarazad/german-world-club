import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import { COOKIES } from '@gwc/contracts/auth'
import { buildAuthApp, createAdmin, createMember, resetAuthTables, bearerFor, PASSWORD } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * The endpoints the console's sign-in and password-reset screens depend on.
 *
 * `POST /auth/sign-in` does not answer "yes" or "no". It answers with one of
 * five outcomes, four of which are a 200 carrying no session — and a client that
 * treated a 200 as success would leave the user staring at a console that never
 * loads. These tests pin the outcomes the browser face can actually reach, so
 * the screen can be written against facts rather than assumptions.
 */

describe.skipIf(!hasDatabase)('sign-in outcomes the browser face can reach', () => {
  let app
  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterAll(async () => { await app.close() })

  const signIn = (email, password = PASSWORD) =>
    app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email, password } })

  it('authenticates a staff account and sets the session cookie', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const response = await signIn(admin.email)

    expect(response.statusCode).toBe(200)
    expect(response.json().outcome).toBe('authenticated')
    expect(response.json().principal.kind).toBe('admin')

    // The browser face carries no bearer token: the session travels as a
    // cookie, which is what `credentials: 'include'` on the client relies on.
    expect(response.json().accessToken).toBeUndefined()
    const cookies = [].concat(response.cookies).map((c) => c.name)
    expect(cookies).toContain(COOKIES.access)
    expect(cookies).toContain(COOKIES.refresh)
  })

  it('authenticates a member the same way', async () => {
    const member = await createMember(app.pg)
    const response = await signIn(member.email)
    expect(response.json().outcome).toBe('authenticated')
    expect(response.json().principal.kind).toBe('member')
  })

  /**
   * A 200 that is NOT a session. This is the outcome the console most needs to
   * handle, because it is the one a legacy-import account hits on every
   * attempt — and treating it as success would loop the user forever.
   */
  it('answers password_reset_required WITHOUT a session', async () => {
    // A legacy MD5 hash is treated as already public and never verified.
    const member = await createMember(app.pg, { passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99' })
    const response = await signIn(member.email)

    expect(response.statusCode).toBe(200)
    expect(response.json().outcome).toBe('password_reset_required')
    expect(response.json().principal).toBeUndefined()
    // Counter-assertion: no cookie was set, so the console cannot mistake this
    // for a session by checking for one.
    expect([].concat(response.cookies ?? []).map((c) => c.name)).not.toContain(COOKIES.access)
  })

  it('answers profile_incomplete for an unconfirmed member, without a session', async () => {
    const member = await createMember(app.pg, { emailConfirmed: false })
    const response = await signIn(member.email)

    expect(response.statusCode).toBe(200)
    expect(response.json().outcome).toBe('profile_incomplete')
    expect(response.json().principal).toBeUndefined()
  })

  /**
   * OTP and device approval are reachable only when the request carries a
   * `deviceId`, which makes it the mobile face. The console never sends one, so
   * it never needs an OTP step — this test is what lets the screen omit it
   * honestly rather than by hoping.
   */
  it('never challenges the browser face for an OTP', async () => {
    const member = await createMember(app.pg, { mobile: '+491700000000', mobileVerified: true })
    const response = await signIn(member.email)
    expect(response.json().outcome).toBe('authenticated')

    // Counter-assertion: the SAME account on the mobile face does get the
    // device gate, so the exemption above is about the face and not about this
    // fixture happening to lack a mobile number.
    const mobile = await app.inject({
      method: 'POST',
      url: '/auth/sign-in',
      payload: { email: member.email, password: PASSWORD, deviceId: 'device-under-test' },
    })
    expect(mobile.json().outcome).not.toBe('authenticated')
  })

  it.each([
    ['locked', 403],
    ['inactive', 403],
    ['ended', 403],
  ])('refuses a %s member with a problem, not an outcome', async (status, expected) => {
    const member = await createMember(app.pg, { status })
    const response = await signIn(member.email)
    expect(response.statusCode).toBe(expected)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
    // The server states the remedy; the console shows it and invents none.
    expect(response.json().detail).toBeTruthy()
  })

})

/**
 * Non-enumeration, on a fresh instance.
 *
 * The sign-in limiter is IP-keyed and counts across a whole run, so by the end
 * of the suite above one arm of this comparison answers 429 and the other 401 —
 * a difference caused by the limiter, not by the accounts. Its own app keeps
 * the comparison about what it claims to be about.
 */
describe.skipIf(!hasDatabase)('sign-in does not reveal whether an address has an account', () => {
  let app
  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterAll(async () => { await app.close() })

  it('answers a wrong password and an unknown address identically', async () => {
    const member = await createMember(app.pg)

    const wrongPassword = await app.inject({
      method: 'POST', url: '/auth/sign-in',
      payload: { email: member.email, password: 'definitely-not-the-password' },
    })
    const noAccount = await app.inject({
      method: 'POST', url: '/auth/sign-in',
      payload: { email: 'nobody-at-all@test.invalid', password: 'definitely-not-the-password' },
    })

    expect(wrongPassword.statusCode).toBe(noAccount.statusCode)
    expect(wrongPassword.json().type).toBe(noAccount.json().type)
    expect(wrongPassword.json().detail).toBe(noAccount.json().detail)
  })
})

/**
 * Signing out is not a privilege on the settings module.
 *
 * `/auth/staff/sign-out` was declared `{ module: 'settings', flag: 'read' }`,
 * which meant a staff member holding `seo.read` and nothing else could sign in,
 * work, and then be refused when they tried to leave. Ending your own session
 * cannot depend on a grant somebody else controls.
 */
describe.skipIf(!hasDatabase)('any authenticated staff member can end their own session', () => {
  let app
  beforeAll(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterAll(async () => { await app.close() })

  it('signs out a staff member who holds no settings grant', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    // Counter-assertion FIRST: the same credential is refused the settings-gated
    // profile route, so the exemption is scoped to sign-out and has not widened
    // into "staff may do anything". Asserted before signing out, because
    // afterwards the session is revoked and a 401 would prove nothing about
    // grants.
    const profile = await app.inject({ method: 'GET', url: '/auth/staff/me', headers: auth })
    expect(profile.statusCode).toBe(403)

    const response = await app.inject({ method: 'POST', url: '/auth/staff/sign-out', headers: auth })
    expect(response.statusCode).toBe(204)
  })

  it('actually ends the session rather than answering 204 and leaving it open', async () => {
    const admin = await createAdmin(app.pg, { grants: { seo: { read: true } } })
    const auth = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

    const before = await app.inject({ method: 'GET', url: '/auth/session', headers: auth })
    expect(before.statusCode).toBe(200)

    await app.inject({ method: 'POST', url: '/auth/staff/sign-out', headers: auth })

    const after = await app.inject({ method: 'GET', url: '/auth/session', headers: auth })
    expect(after.statusCode).toBeGreaterThanOrEqual(401)
  })

  it('still refuses an anonymous sign-out', async () => {
    const response = await app.inject({ method: 'POST', url: '/auth/staff/sign-out' })
    expect(response.statusCode).toBeGreaterThanOrEqual(401)
  })
})

describe.skipIf(!hasDatabase)('password reset, end to end', () => {
  let app
  let sent

  /**
   * A fresh instance per test, deliberately.
   *
   * The reset-request route is rate limited per IP and the limiter counts
   * across a whole instance. Sharing one app made the fourth request in this
   * suite answer 429, which left `sent` empty, which sent `token: undefined`
   * to the confirm route — and surfaced three assertions later as "the reset
   * did not take effect". The product was fine; the suite was measuring the
   * limiter. Rebuilding is a second or two and makes each test mean what it
   * says.
   */
  beforeEach(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
    sent = []
    // The mail side is stubbed so the token can be read; everything else —
    // hashing, the row lock, session revocation — is the real path.
    app.sendResetMail = async (payload) => { sent.push(payload) }
  })
  afterEach(async () => { await app.close() })

  /** Request a reset and hand back the token, failing loudly if none arrived. */
  const requestReset = async (email) => {
    const response = await app.inject({
      method: 'POST', url: '/auth/password-reset/request', payload: { email },
    })
    expect(response.statusCode, 'reset request was refused').toBe(202)
    expect(sent, 'no reset mail was sent').toHaveLength(1)
    return sent[0].token
  }

  it('accepts a request for an address that exists and one that does not, identically', async () => {
    const member = await createMember(app.pg)

    const known = await app.inject({
      method: 'POST', url: '/auth/password-reset/request', payload: { email: member.email },
    })
    const unknown = await app.inject({
      method: 'POST', url: '/auth/password-reset/request', payload: { email: 'nobody@test.invalid' },
    })

    // Identical in status AND body. Any difference is an account-existence
    // oracle, which for an invite-only club is most of the harm.
    expect(known.statusCode).toBe(unknown.statusCode)
    expect(known.body).toBe(unknown.body)
  })

  it('completes a reset and lets the new password sign in', async () => {
    const member = await createMember(app.pg)
    const token = await requestReset(member.email)

    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, password: 'ein-ganz-neues-passwort' },
    })
    expect(confirm.statusCode).toBe(200)

    const signedIn = await app.inject({
      method: 'POST', url: '/auth/sign-in',
      payload: { email: member.email, password: 'ein-ganz-neues-passwort' },
    })
    expect(signedIn.json().outcome).toBe('authenticated')

    // Counter-assertion: the OLD password no longer works. Without this the
    // test above would pass against a reset that set nothing.
    const oldPassword = await app.inject({
      method: 'POST', url: '/auth/sign-in', payload: { email: member.email, password: PASSWORD },
    })
    // 401: INVALID_CREDENTIALS. The status gates (locked/inactive/ended) are
    // the 403s — a wrong password is an authentication failure, not a posture.
    expect(oldPassword.statusCode).toBe(401)
  })

  it('refuses a reset token a second time', async () => {
    const member = await createMember(app.pg)
    const token = await requestReset(member.email)

    const first = await app.inject({
      method: 'POST', url: '/auth/password-reset/confirm', payload: { token, password: 'erstes-neues-passwort' },
    })
    expect(first.statusCode).toBe(200)

    // Replay of a single-use credential is compromise, not a retry.
    const second = await app.inject({
      method: 'POST', url: '/auth/password-reset/confirm', payload: { token, password: 'zweites-neues-passwort' },
    })
    expect(second.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('refuses a token that never existed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: 'x'.repeat(64), password: 'irgendein-neues-passwort' },
    })
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
  })

  it('rejects a password below the documented minimum with a validation problem', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: 'x'.repeat(64), password: 'kurz' },
    })
    // 400, not 403: the console shows this against the field rather than as a
    // refusal of the link.
    expect(response.statusCode).toBe(400)
  })

  it('clears a password_reset_required account once the reset completes', async () => {
    const member = await createMember(app.pg, { passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99' })

    const before = await app.inject({
      method: 'POST', url: '/auth/sign-in', payload: { email: member.email, password: PASSWORD },
    })
    expect(before.json().outcome).toBe('password_reset_required')

    const token = await requestReset(member.email)
    await app.inject({
      method: 'POST', url: '/auth/password-reset/confirm',
      payload: { token, password: 'legacy-konto-neues-passwort' },
    })

    const after = await app.inject({
      method: 'POST', url: '/auth/sign-in',
      payload: { email: member.email, password: 'legacy-konto-neues-passwort' },
    })
    expect(after.json().outcome).toBe('authenticated')
  })
})
