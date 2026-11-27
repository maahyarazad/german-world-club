import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { createMember, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildOnboardingApp } from '../onboarding/helpers.ts'
import { OTP_OUTCOME, issueChallenge, verifyChallenge } from '../../src/modules/auth/otp.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043: a reset code opens nothing else, and nothing else resets.
 *
 * A one-time code carries a PURPOSE, and every endpoint redeems only its own. That is
 * what makes the fifth purpose safe to add: `/auth/verify-otp` and
 * `/onboarding/verify-mobile` each OPEN A SESSION for a valid code of their purposes, so
 * a reset code that any of them accepted would sign someone in without a password. And the
 * other way round, a sign-in or onboarding code must not reset a password.
 *
 * Two more things are pinned, both about not leaking whether a reset challenge is real:
 *  - at an endpoint that does not redeem resets, a reset challenge is INVISIBLE: it is
 *    answered exactly like an id that never existed, and presenting it changes nothing
 *    (not counted as a try, not consumed). Otherwise five presentations would end a real
 *    challenge (`429`, then `410`) while a made-up id stayed `401` for ever, which tells a
 *    stranger whether an identifier has an account (research R17).
 *  - this is NOT done for the other purposes, whose counting is unchanged.
 *
 * Each endpoint refuses a code of the wrong LENGTH on shape before it ever looks at the
 * purpose, so every challenge below is built with the digit count the endpoint under test
 * expects. Otherwise the test would pass without the purpose check ever being reached.
 */
const DEVICE = 'device-purpose-test'
const NEW_PASSWORD = 'ein-ganz-neues-passwort'

let app: GwcApp
// The onboarding app, because its SMS provider is a recorder: the resend cases below assert on
// what was (and was not) texted.
let sms: { mobile: string; code: string }[]
beforeAll(async () => {
  if (!hasDatabase) return
  ;({ app, sms } = await buildOnboardingApp())
})
afterAll(async () => { await app?.close() })

/** What a response says, with the per-request ids taken out. */
const comparable = (r: { statusCode: number; json(): Record<string, unknown>; headers: Record<string, unknown> }) => ({
  status: r.statusCode,
  body: { ...r.json(), instance: null, requestId: null },
  headers: Object.fromEntries(Object.entries(r.headers).filter(([k]) =>
    !['x-request-id', 'x-client-request-id', 'date', 'content-length', 'content-security-policy', 'etag'].includes(k)
    && !/^(retry-after|x-?ratelimit.*|ratelimit.*)$/i.test(k))),
})

const UNKNOWN_ID = '8f14e45f-ceea-4e67-9c5a-0a1b2c3d4e5f'

describe.skipIf(!hasDatabase)('one-time code purposes (feature 043)', () => {
  let memberId: string

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    sms.length = 0
    const member = await createMember(app.pg, { mobile: '+4915112345678', mobileVerified: true })
    memberId = member.id
  })

  const issue = (purpose: 'login' | 'device_approval' | 'mobile_verification' | 'email_verification' | 'password_reset', digits: number) =>
    issueChallenge(app.pg, { accountId: memberId, accountKind: 'member', deviceId: DEVICE, purpose, digits })

  const challengeRow = async (id: string) =>
    (await app.pg.query('SELECT attempts, consumed_at FROM otp_challenges WHERE id = $1', [id])).rows[0]

  const sessionsOf = async () =>
    (await app.pg.query('SELECT count(*)::int AS n FROM sessions WHERE account_id = $1', [memberId])).rows[0].n as number

  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: 'POST', url, payload })

  describe('a reset code, presented where a session would open', () => {
    it.each([
      ['/auth/verify-otp'],
      ['/onboarding/verify-mobile'],
    ])('is refused at %s like an id that never existed, and opens nothing', async (url) => {
      const { challengeId, code } = await issue('password_reset', 4)
      const fake = await post(url, { challengeId: UNKNOWN_ID, code, deviceId: DEVICE })
      expect(fake.statusCode).toBe(401)
      expect(fake.json().type).toBe(PROBLEMS.INVALID_OTP.type)

      // Even with the CORRECT code and device, the first time and the sixth.
      for (let presentation = 1; presentation <= 6; presentation += 1) {
        const real = await post(url, { challengeId, code, deviceId: DEVICE })
        expect(comparable(real), `presentation ${presentation}`).toEqual(comparable(fake))
        const body = real.json()
        expect(body.accessToken).toBeUndefined()
        expect(body.refreshToken).toBeUndefined()
        expect(real.headers['set-cookie']).toBeUndefined()
      }
      expect(await sessionsOf()).toBe(0)

      // Invisible: presenting it elsewhere neither counted a try nor spent the code.
      expect(await challengeRow(challengeId)).toEqual({ attempts: 0, consumed_at: null })
    })

    // The counter-assertion: the endpoint DOES open a session for a code of its own purpose,
    // so the refusals above are the purpose check, not an endpoint that refuses everything.
    it('while a sign-in code of the same shape does open a session at /auth/verify-otp', async () => {
      const { challengeId, code } = await issue('login', 4)
      const opened = await post('/auth/verify-otp', { challengeId, code, deviceId: DEVICE })
      expect(opened.statusCode).toBe(200)
      expect(opened.json().accessToken).toEqual(expect.any(String))
      expect(await sessionsOf()).toBe(1)
    })

    it('and an onboarding code is accepted by its own redeemer (the application-level rule)', async () => {
      const { challengeId, code } = await issue('mobile_verification', 4)
      const result = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE, purposes: ['mobile_verification'] })
      expect(result.outcome).toBe(OTP_OUTCOME.VERIFIED)
    })
  })

  describe('a code from anywhere else, presented to reset a password', () => {
    it.each(['login', 'device_approval', 'mobile_verification', 'email_verification'] as const)(
      'a %s code changes nothing and is refused like a wrong code',
      async (purpose) => {
        const before = (await app.pg.query('SELECT password_hash FROM members WHERE id = $1', [memberId])).rows[0].password_hash
        // Six digits: the length the reset endpoint accepts, so its purpose check is reached.
        const { challengeId, code } = await issue(purpose, 6)

        const answer = await post('/auth/password-reset/code/confirm', {
          challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD,
        })

        expect(answer.statusCode).toBe(401)
        expect(answer.json().type).toBe(PROBLEMS.INVALID_OTP.type)
        const after = (await app.pg.query('SELECT password_hash FROM members WHERE id = $1', [memberId])).rows[0].password_hash
        expect(after).toBe(before)
      },
    )
  })

  describe('the rule underneath, applied directly', () => {
    it('a correct reset code is invalid to a caller that redeems only sign-in codes, and untouched by it', async () => {
      const { challengeId, code } = await issue('password_reset', 6)

      const elsewhere = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE, purposes: ['login', 'device_approval'] })

      expect(elsewhere.outcome).toBe(OTP_OUTCOME.INVALID)
      expect(await challengeRow(challengeId)).toEqual({ attempts: 0, consumed_at: null })
      // Counter-assertion: the same code is verified by the caller that redeems resets.
      const own = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE, purposes: ['password_reset'] })
      expect(own.outcome).toBe(OTP_OUTCOME.VERIFIED)
      expect(own.accountId).toBe(memberId)
    })

    it('a spent or exhausted reset challenge is just as invisible elsewhere as a live one', async () => {
      const spent = await issue('password_reset', 6)
      await app.pg.query('UPDATE otp_challenges SET consumed_at = now() WHERE id = $1', [spent.challengeId])
      const exhausted = await issue('password_reset', 6)
      await app.pg.query('UPDATE otp_challenges SET attempts = 5 WHERE id = $1', [exhausted.challengeId])

      for (const challenge of [spent, exhausted]) {
        const result = await verifyChallenge(app.pg, {
          challengeId: challenge.challengeId, code: challenge.code, deviceId: DEVICE, purposes: ['login', 'device_approval'],
        })
        // `invalid`, not `expired` or `attempts_exceeded`: those would say the challenge exists.
        expect(result.outcome).toBe(OTP_OUTCOME.INVALID)
      }
    })
  })

  describe('resending (POST /auth/otp/resend)', () => {
    const settle = () => new Promise((resolve) => setTimeout(resolve, 80))
    const cooldownOver = (challengeId: string) =>
      app.pg.query(`UPDATE otp_challenges SET created_at = now() - interval '120 seconds' WHERE id = $1`, [challengeId])
    const resend = (challengeId: string) => app.inject({ method: 'POST', url: '/auth/otp/resend', payload: { challengeId } })
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const normalised = (r: Parameters<typeof comparable>[0]) => {
      const c = comparable(r)
      const body = c.body as Record<string, unknown>
      if (typeof body.challengeId === 'string' && uuid.test(body.challengeId)) body.challengeId = '<uuid>'
      return c
    }
    const challengeCount = async () =>
      (await app.pg.query('SELECT count(*)::int AS n FROM otp_challenges WHERE account_id = $1', [memberId])).rows[0].n as number

    // A resend of a reset challenge is answered like a resend of an id that never existed, even
    // once the cooldown is over (when an ordinary resend WOULD send). Answering differently, for
    // instance 429 inside the cooldown, would let anyone tell a real reset challenge from the
    // random one a non-matching identifier is given (research R17); and a real resend would be a
    // second way to text a reset code outside the three-an-hour budget.
    it('answers a reset challenge exactly like an id that never existed, sends nothing and spends nothing', async () => {
      const { challengeId, code } = await issue('password_reset', 6)
      await cooldownOver(challengeId)
      const unknown = await resend(UNKNOWN_ID)
      expect(unknown.statusCode).toBe(202)

      for (let n = 1; n <= 3; n += 1) {
        const real = await resend(challengeId)
        expect(normalised(real), `resend ${n}`).toEqual(normalised(unknown))
        // And inside the cooldown too: the answer does not change with the challenge's age.
        await app.pg.query(`UPDATE otp_challenges SET created_at = now() WHERE id = $1`, [challengeId])
        expect(normalised(await resend(challengeId))).toEqual(normalised(unknown))
        await cooldownOver(challengeId)
      }

      await settle()
      expect(sms, 'a text was sent').toEqual([])
      expect(await challengeCount(), 'a new challenge was issued').toBe(1)
      // Untouched: still live, and its code still resets a password.
      expect(await challengeRow(challengeId)).toEqual({ attempts: 0, consumed_at: null })
      const confirmed = await post('/auth/password-reset/code/confirm', {
        challengeId, code, deviceId: DEVICE, password: NEW_PASSWORD,
      })
      expect(confirmed.statusCode).toBe(200)
    })

    // The counter-assertion: every other purpose resends exactly as it always did, so the case
    // above is a rule about reset challenges and not a resend that stopped working.
    it('while an ordinary sign-in challenge still gets a new four-digit code by text', async () => {
      const { challengeId } = await issue('login', 4)
      await cooldownOver(challengeId)

      const resent = await resend(challengeId)

      expect(resent.statusCode).toBe(202)
      expect(resent.json().challengeId).not.toBe(challengeId)
      await vi.waitFor(() => expect(sms).toHaveLength(1))
      expect(sms[0]).toMatchObject({ mobile: '+4915112345678', code: expect.stringMatching(/^\d{4}$/) })
    })
  })
})

