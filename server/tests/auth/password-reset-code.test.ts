import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { PASSWORD, bearerFor, createAdmin, createMember, resetAuthTables, signIn } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp, nextAddress, uniqueMobile } from '../onboarding/helpers.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043: resetting a forgotten password in the app with a code texted to the
 * number on record.
 *
 * THE ASK. The answer to "send me a code" is the same for every identifier, because
 * anything else is an account-existence oracle on an unauthenticated route: a screen
 * that said "no account found" would let anyone list the club's members, and one that
 * said "sent to ••• 4567" would hand out a fragment of a phone number. So an
 * identifier that matches nobody, a merchant, a locked member and a provider outage
 * are each answered byte for byte like the one case that really sent a code, and the
 * text is sent after the reply so even the time it takes does not tell them apart.
 *
 * `uniqueMobile()` builds a real German mobile; the fixtures never use a number that
 * would fail `isValidMobileE164`, because loosening that rule to keep a fixture is how
 * feature 031's bug came back.
 */
const DEVICE = 'device-reset-test'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

let app: GwcApp
let sms: { mobile: string; code: string }[]
let smsControl: { failure: unknown }

beforeAll(async () => {
  if (!hasDatabase) return
  ;({ app, sms, smsControl } = await buildOnboardingApp())
})
afterAll(async () => { await app?.close() })

beforeEach(async () => {
  if (!hasDatabase) return
  await resetAuthTables(app.pg)
  sms.length = 0
  smsControl.failure = null
})

/**
 * Ask for a code. Each ask comes from its own address: the route has a per-address
 * bucket (20 an hour) and a suite sharing one address would end up testing the
 * limiter, which has a file of its own (password-reset-limits.test.ts).
 */
const post = (payload: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/auth/password-reset/code', payload, remoteAddress: nextAddress() })

const ask = (identifier: { email: string } | { mobile: string } | Record<string, unknown>, deviceId: string = DEVICE) =>
  post({ ...identifier, deviceId })

/**
 * What a response says about the account, with what varies per request by
 * construction taken out: the request id, the date, the challenge id's VALUE (which
 * is random for a non-match by design, and still has to be a uuid), and the
 * remaining-budget headers, whose values count down per request.
 */
const RATE_HEADER = /^(retry-after|x-?ratelimit.*|ratelimit.*)$/i
const shape = (response: { statusCode: number; json(): Record<string, unknown>; headers: Record<string, unknown> }) => {
  const body = response.json()
  const names = Object.keys(response.headers)
  return {
    status: response.statusCode,
    body: { ...body, challengeId: typeof body.challengeId === 'string' && UUID.test(body.challengeId) ? '<uuid>' : body.challengeId, instance: null, requestId: null },
    headers: Object.fromEntries(
      Object.entries(response.headers).filter(([k]) => !RATE_HEADER.test(k) && ![
        'x-request-id', 'x-client-request-id', 'date', 'content-length', 'content-security-policy', 'etag',
      ].includes(k)),
    ),
    rateHeaderNames: names.filter((k) => RATE_HEADER.test(k) && !/^(retry-after)$/i.test(k)).sort(),
  }
}

/** A member the route will really send to: active, with a verified mobile number. */
const eligible = (overrides: Parameters<typeof createMember>[1] = {}) =>
  createMember(app.pg, { mobile: uniqueMobile(), mobileVerified: true, ...overrides })

/** `createMember` returns the id and email only; the number is what a text is addressed to. */
const mobileOf = async (memberId: string): Promise<string> =>
  (await app.pg.query('SELECT mobile FROM members WHERE id = $1', [memberId])).rows[0].mobile

/** Give a detached send time to happen, for the assertions that something was NOT sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 80))

const challengesOf = async (memberId: string) =>
  (await app.pg.query(
    `SELECT id, purpose, device_id, code_hash, expires_at, consumed_at
       FROM otp_challenges WHERE account_id = $1 AND account_kind = 'member' ORDER BY created_at`,
    [memberId],
  )).rows

describe.skipIf(!hasDatabase)('asking for a reset code (feature 043)', () => {
  it('texts a six-digit code to the number on record when asked by EMAIL, and answers 202', async () => {
    const member = await eligible()

    const response = await ask({ email: member.email })

    expect(response.statusCode).toBe(202)
    const body = response.json()
    expect(body).toEqual({ requested: true, challengeId: expect.stringMatching(UUID), cooldownSeconds: 60 })

    await vi.waitFor(() => expect(sms).toHaveLength(1))
    expect(sms[0]!.mobile).toBe(await mobileOf(member.id))
    expect(sms[0]!.code).toMatch(/^\d{6}$/)

    const [challenge] = await challengesOf(member.id)
    expect(challenge).toMatchObject({ purpose: 'password_reset', device_id: DEVICE, consumed_at: null })
    expect(challenge.id).toBe(body.challengeId)
    // Valid for about five minutes, and what is stored is a digest, never the code.
    const seconds = (new Date(challenge.expires_at).getTime() - Date.now()) / 1000
    expect(seconds).toBeGreaterThan(290)
    expect(seconds).toBeLessThanOrEqual(300)
    expect(Buffer.from(challenge.code_hash).length).toBe(32)
    expect(Buffer.from(challenge.code_hash).toString('utf8')).not.toContain(sms[0]!.code)
  })

  it('does the same when asked by MOBILE NUMBER', async () => {
    const member = await eligible()
    const mobile = await mobileOf(member.id)

    const response = await ask({ mobile })

    expect(response.statusCode).toBe(202)
    await vi.waitFor(() => expect(sms).toHaveLength(1))
    expect(sms[0]).toMatchObject({ mobile, code: expect.stringMatching(/^\d{6}$/) })
  })

  describe('answers the same for everyone, so it cannot say who has an account', () => {
    // Every row below must be indistinguishable from the one case that really sends.
    it.each([
      ['an email that matches nobody', async () => ({ email: `nobody-${Date.now()}@test.invalid` })],
      ['a number that matches nobody', async () => ({ mobile: uniqueMobile() })],
      ['a member whose mobile number is not verified', async () => ({
        email: (await createMember(app.pg, { mobile: uniqueMobile(), mobileVerified: false })).email })],
      ['a member with no mobile number at all', async () => ({ email: (await createMember(app.pg)).email })],
      ['a locked member', async () => ({ email: (await eligible({ status: 'locked' })).email })],
      ['an ended member', async () => ({ email: (await eligible({ status: 'ended' })).email })],
      ['a member in a country the club does not text', async () => ({
        email: (await createMember(app.pg, { mobile: '+989121234567', mobileVerified: true })).email })],
      ['a member in a +1 area outside the US', async () => ({
        email: (await createMember(app.pg, { mobile: '+14165550123', mobileVerified: true })).email })],
      ['a merchant account', async () => {
        const merchant = await organisationUser(app, 'merchant')
        return { email: (await app.pg.query('SELECT email FROM organisation_users WHERE id = $1', [merchant.id])).rows[0].email }
      }],
      ['a partner account', async () => {
        const partner = await organisationUser(app, 'partner')
        return { email: (await app.pg.query('SELECT email FROM organisation_users WHERE id = $1', [partner.id])).rows[0].email }
      }],
      ['a staff account', async () => ({ email: (await createAdmin(app.pg)).email })],
    ])('%s', async (_label, build) => {
      // The reference: the one case that really sends.
      const real = await eligible()
      const reference = await ask({ email: real.email })
      expect(reference.statusCode).toBe(202)
      await vi.waitFor(() => expect(sms).toHaveLength(1))
      sms.length = 0

      const answer = await ask(await build())

      expect(shape(answer)).toEqual(shape(reference))
      // The id is still a uuid, though no code belongs to it.
      expect(answer.json().challengeId).toMatch(UUID)
      // The counter-assertion: the reference DID send and this did not, so the equality
      // above is between a real send and a refusal, not between two silences.
      await settle()
      expect(sms).toEqual([])
    })

    it('a provider outage (the text cannot be sent) is answered like a success', async () => {
      const real = await eligible()
      const reference = await ask({ email: real.email })
      await vi.waitFor(() => expect(sms).toHaveLength(1))
      sms.length = 0

      smsControl.failure = Object.assign(new Error('provider down'), { statusCode: 503 })
      const down = await eligible()
      const answer = await ask({ email: down.email })

      expect(shape(answer)).toEqual(shape(reference))
      await settle()
      expect(sms).toEqual([]) // it really did fail to send; the answer did not say so
    })
  })

  it('leaves exactly one live code when asked twice: the second supersedes the first', async () => {
    const member = await eligible()
    const mobile = await mobileOf(member.id)

    const first = await ask({ email: member.email })
    const second = await ask({ mobile })

    const rows = await challengesOf(member.id)
    expect(rows).toHaveLength(2)
    const live = rows.filter((r) => r.consumed_at === null)
    expect(live).toHaveLength(1)
    expect(live[0].id).toBe(second.json().challengeId)
    expect(rows.find((r) => r.id === first.json().challengeId)!.consumed_at).not.toBeNull()
  })

  it('leaves at most one live code when asked three times at once (the row lock)', async () => {
    const member = await eligible()

    const answers = await Promise.all([ask({ email: member.email }), ask({ email: member.email }), ask({ email: member.email })])

    expect(answers.map((r) => r.statusCode)).toEqual([202, 202, 202])
    const rows = await challengesOf(member.id)
    expect(rows.length).toBe(3)
    expect(rows.filter((r) => r.consumed_at === null)).toHaveLength(1)
  })

  // A malformed body is refused before anything is looked up, so it says nothing about
  // accounts. Any failing `mobile` field is the platform's `422 invalid-mobile` (feature 031,
  // the same answer registration gives, and the app shows it); everything else is a 400.
  it.each([
    ['both identifiers', (m: { email: string }) => ({ email: m.email, mobile: '+4915112345678' }), PROBLEMS.VALIDATION_FAILED],
    ['neither identifier', () => ({}), PROBLEMS.VALIDATION_FAILED],
    ['something that is not an email', () => ({ email: 'not-an-email' }), PROBLEMS.VALIDATION_FAILED],
    ['a number that is the right shape and not a number', () => ({ mobile: '+49971585831595' }), PROBLEMS.INVALID_MOBILE],
    ['a number without its country code', () => ({ mobile: '015112345678' }), PROBLEMS.INVALID_MOBILE],
  ])('refuses %s, and sends nothing', async (_label, build, problem) => {
    const member = await eligible()
    const answer = await ask(build(member))
    expect(answer.statusCode).toBe(problem.status)
    expect(answer.json().type).toBe(problem.type)
    await settle()
    expect(sms).toEqual([])
  })

  it('refuses a request with no device', async () => {
    const member = await eligible()
    const answer = await post({ email: member.email }) // no deviceId at all
    expect(answer.statusCode).toBe(400)
    expect(answer.json().type).toBe(PROBLEMS.VALIDATION_FAILED.type)
    await settle()
    expect(sms).toEqual([])
  })

  it('never puts a fragment of the number, or the words "account" or "member", in the answer', async () => {
    const member = await eligible()
    const mobile = await mobileOf(member.id)

    const response = await ask({ email: member.email })
    // Without this a missing route (a 404 body) would pass every "not contain" below.
    expect(response.statusCode).toBe(202)

    // The challenge id is removed first: a random uuid could contain any four digits.
    const text = JSON.stringify({ ...response.json(), challengeId: null }).toLowerCase()
    expect(text).not.toContain(mobile.slice(-4))
    expect(text).not.toContain(mobile.slice(3, 9))
    expect(text).not.toContain('account')
    expect(text).not.toContain('member')
  })

  describe('the text is sent after the reply, never before it', () => {
    it('answers 202 at once even when the provider never answers', async () => {
      const member = await eligible()
      const provider = app.integrations.sms as { sendCode: (input: unknown) => Promise<unknown> }
      const original = provider.sendCode
      provider.sendCode = () => new Promise(() => {}) // hangs forever
      try {
        const started = performance.now()
        const response = await ask({ email: member.email })
        expect(response.statusCode).toBe(202)
        expect(performance.now() - started).toBeLessThan(1000)
      } finally { provider.sendCode = original }
    })

    it('logs a send that fails after the reply, and throws nothing', async () => {
      const member = await eligible()
      const provider = app.integrations.sms as { sendCode: (input: unknown) => Promise<unknown> }
      const original = provider.sendCode
      provider.sendCode = async () => {
        await new Promise((resolve) => setTimeout(resolve, 30))
        throw Object.assign(new Error('late failure'), { statusCode: 503 })
      }
      const unhandled: unknown[] = []
      const onUnhandled = (reason: unknown) => { unhandled.push(reason) }
      process.on('unhandledRejection', onUnhandled)
      const warn = vi.spyOn(app.log, 'warn')
      try {
        const response = await ask({ email: member.email })
        expect(response.statusCode).toBe(202)
        await vi.waitFor(() => expect(warn.mock.calls.some((call) => call[1] === 'PASSWORD_RESET_SMS_NOT_SENT')).toBe(true))
        await settle()
        expect(unhandled).toEqual([])
        // The log line names the route and the error kind, never the number, the code or the message.
        const line = warn.mock.calls.find((call) => call[1] === 'PASSWORD_RESET_SMS_NOT_SENT')!
        const logged = JSON.stringify(line[0])
        expect(logged).not.toContain('+49')
        expect(logged).not.toContain('late failure')
      } finally {
        provider.sendCode = original
        process.off('unhandledRejection', onUnhandled)
        warn.mockRestore()
      }
    })
  })
})

/**
 * CONFIRMING. The code and the new password in one request.
 *
 * Every way a code can fail (wrong, expired, spent, exhausted, another device, an id
 * that never existed, a member who was locked after asking) is answered with the SAME
 * `401 invalid-otp`: status, headers and body. A distinct answer for any of them (a
 * `410` for expired, a `429` for "too many tries") would let a caller tell a real
 * challenge from the random one a non-matching identifier is given, and so learn who
 * has an account (research R17). The counter and the ceiling still work; they just do
 * not announce themselves. `refused()` is that one answer, taken from a plain wrong code.
 */
const NEW_PASSWORD = 'ein-ganz-neues-passwort'

const confirm = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/auth/password-reset/code/confirm', payload: body, remoteAddress: nextAddress() })

/** Ask through the real route and read the code the stub captured (the text is sent after the reply). */
const askAndRead = async (identifier: { email: string } | { mobile: string }, deviceId = DEVICE) => {
  sms.length = 0
  const answer = await ask(identifier, deviceId)
  expect(answer.statusCode).toBe(202)
  await vi.waitFor(() => expect(sms).toHaveLength(1))
  return { challengeId: answer.json().challengeId as string, code: sms[0]!.code }
}

/** A six-digit code that is not `code`. */
const wrongCodeFor = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0')

const attemptsOf = async (challengeId: string) =>
  (await app.pg.query('SELECT attempts FROM otp_challenges WHERE id = $1', [challengeId])).rows[0].attempts as number

const passwordHashOf = async (memberId: string) =>
  (await app.pg.query('SELECT password_hash FROM members WHERE id = $1', [memberId])).rows[0].password_hash as string

describe.skipIf(!hasDatabase)('confirming a reset code with a new password (feature 043)', () => {
  /** The one answer every failed code gets, taken from a plain wrong code on a throwaway member. */
  const refused = async () => {
    const other = await eligible()
    const { challengeId, code } = await askAndRead({ email: other.email })
    const wrong = await confirm({ challengeId, code: wrongCodeFor(code), deviceId: DEVICE, password: NEW_PASSWORD })
    expect(wrong.statusCode).toBe(401)
    expect(wrong.json().type).toBe(PROBLEMS.INVALID_OTP.type)
    return shape(wrong)
  }

  it('changes the password, clears the flag and ends every session', async () => {
    const member = await eligible({ passwordResetRequired: true })
    const { authorization, sessionId } = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization } })).statusCode).toBe(200)
    const { challengeId, code } = await askAndRead({ email: member.email })

    const done = await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })

    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ reset: true })
    expect(done.headers['cache-control']).toBe('private, no-store')

    // The new password signs in and the old one does not (so the first is not a no-op).
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
    expect((await signIn(app, member.email, PASSWORD)).statusCode).toBe(401)
    const row = (await app.pg.query('SELECT status, password_reset_required AS flag FROM members WHERE id = $1', [member.id])).rows[0]
    expect(row).toEqual({ status: 'active', flag: false })

    // Every session is over, on the very next request.
    expect((await app.inject({ method: 'GET', url: '/auth/me', headers: { authorization } })).statusCode).toBe(401)
    const session = (await app.pg.query('SELECT revoked_reason FROM sessions WHERE id = $1', [sessionId])).rows[0]
    expect(session.revoked_reason).toBe('password_reset')

    // Audited as an SMS reset, and nothing in any entry's detail holds the code or the password.
    const audit = (await app.pg.query(
      `SELECT action, detail FROM audit_log WHERE actor_id = $1 AND action IN ('session_revoked', 'password_reset') ORDER BY id`,
      [member.id],
    )).rows
    expect(audit.map((r) => r.action).sort()).toEqual(['password_reset', 'session_revoked'])
    expect(audit.find((r) => r.action === 'password_reset')!.detail).toEqual({ reason: 'sms' })
    const details = JSON.stringify(audit.map((r) => r.detail))
    expect(details).not.toContain(code)
    expect(details).not.toContain(NEW_PASSWORD)
  })

  // An inactive member is reactivated by completing a reset, as the emailed link already does (section 3.2).
  // Its own test: an inactive member's session is refused before the reset, so it cannot share the
  // "the session worked until the reset" precondition above.
  it('reactivates an inactive member', async () => {
    const member = await eligible({ status: 'inactive' })
    const { challengeId, code } = await askAndRead({ email: member.email })

    expect((await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })).statusCode).toBe(200)

    const { rows } = await app.pg.query('SELECT status FROM members WHERE id = $1', [member.id])
    expect(rows[0].status).toBe('active')
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
  })

  it('works once: the same code a second time is the one refusal', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })
    const standard = await refused()
    expect((await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })).statusCode).toBe(200)

    const replay = await confirm({ challengeId, code, deviceId: DEVICE, password: 'zweites-neues-passwort' })

    expect(shape(replay)).toEqual(standard)
    // And the replay changed nothing: the first reset's password is still the one.
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
  })

  it('counts wrong tries, ends the code at the fifth, and says the same thing every time', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })
    const before = await passwordHashOf(member.id)
    const standard = await refused()

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await confirm({ challengeId, code: wrongCodeFor(code), deviceId: DEVICE, password: NEW_PASSWORD })
      // Never a 429 "too many tries" and never a 410: the fifth looks like the first.
      expect(shape(wrong), `wrong try ${attempt}`).toEqual(standard)
      expect(await attemptsOf(challengeId)).toBe(attempt)
    }

    // The code is dead now: even the right one is refused, with the same answer.
    const dead = await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })
    expect(shape(dead)).toEqual(standard)
    expect(await passwordHashOf(member.id)).toBe(before)
  })

  it('refuses an expired code like any other bad code', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })
    const standard = await refused()
    await app.pg.query(`UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1`, [challengeId])

    expect(shape(await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD }))).toEqual(standard)
  })

  it('refuses the right code from a different device, and counts it as a try', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })
    const standard = await refused()

    const elsewhere = await confirm({ challengeId, code, deviceId: 'some-other-phone', password: NEW_PASSWORD })

    expect(shape(elsewhere)).toEqual(standard)
    expect(await attemptsOf(challengeId)).toBe(1)
  })

  it('refuses a challenge id that never existed, like any other bad code', async () => {
    const standard = await refused()
    const unknown = await confirm({
      challengeId: '8f14e45f-ceea-4e67-9c5a-0a1b2c3d4e5f', code: '123456', deviceId: DEVICE, password: NEW_PASSWORD,
    })
    expect(shape(unknown)).toEqual(standard)
  })

  it('refuses a password that is too short BEFORE looking at the code, so no guess is spent', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })

    const short = await confirm({ challengeId, code, deviceId: DEVICE, password: 'x'.repeat(7) })

    expect(short.statusCode).toBe(400)
    expect(short.json().type).toBe(PROBLEMS.VALIDATION_FAILED.type)
    expect(await attemptsOf(challengeId)).toBe(0)
    // The counter-assertion: the same code, with a good password, still works.
    expect((await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })).statusCode).toBe(200)
  })

  it('refuses a member who was locked after asking, and leaves the password alone', async () => {
    const member = await eligible()
    const { challengeId, code } = await askAndRead({ email: member.email })
    const standard = await refused()
    const before = await passwordHashOf(member.id)
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [member.id])

    const late = await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })

    expect(shape(late)).toEqual(standard)
    expect(await passwordHashOf(member.id)).toBe(before)
  })

  it('changes only the password of the member the code was sent to', async () => {
    const mine = await eligible()
    const theirs = await eligible()
    const theirsBefore = await passwordHashOf(theirs.id)
    const { challengeId, code } = await askAndRead({ email: mine.email })

    expect((await confirm({ challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD })).statusCode).toBe(200)

    expect(await passwordHashOf(theirs.id)).toBe(theirsBefore)
    expect((await signIn(app, theirs.email, PASSWORD)).body.outcome).toBe('authenticated')
  })
})

