import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'
import {
  issueChallenge, verifyChallenge, generateCode, hashCode, maskPhone,
  OTP_OUTCOME, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS,
} from '../../src/modules/auth/otp.js'

/**
 * FR-012 / §6.2 — the three things that make a 4-digit code safe.
 *
 * The code itself is only 10,000 possibilities, so none of its safety comes
 * from its entropy. It comes from the attempt ceiling that invalidates the
 * challenge, the five-minute expiry, and the binding to the device that asked.
 * Each is asserted here on its own, because losing any one of them silently
 * reduces the factor to a guessing game that succeeds in an afternoon.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe('the code itself', () => {
  it('is always four digits, zero-padded', () => {
    for (let i = 0; i < 200; i += 1) expect(generateCode()).toMatch(/^\d{4}$/)
  })

  it('salts the digest with the challenge id, so equal codes are unequal hashes', () => {
    const a = hashCode('1234', '11111111-1111-1111-1111-111111111111')
    const b = hashCode('1234', '22222222-2222-2222-2222-222222222222')
    expect(a.equals(b)).toBe(false)
  })

  it('masks the destination to the last four digits, never the whole number', () => {
    expect(maskPhone('+971501234567')).toBe('•••• 4567')
    expect(maskPhone('+971501234567')).not.toContain('50123')
    expect(maskPhone(null)).toBe('••••')
  })
})

describe.skipIf(!hasDatabase)('the challenge (FR-012)', () => {
  let member
  const DEVICE = 'device-under-test'

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg, { mobile: '+971501234567', mobileVerified: true })
  })

  const issue = () => issueChallenge(app.pg, {
    accountId: member.id, accountKind: 'member', deviceId: DEVICE,
  })

  it('verifies a correct code from the right device exactly once', async () => {
    const { challengeId, code } = await issue()

    const first = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE })
    expect(first.outcome).toBe(OTP_OUTCOME.VERIFIED)
    expect(first.accountId).toBe(member.id)

    // Consumed. A replay of a correct code must not mint a second session.
    const replay = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE })
    expect(replay.outcome).toBe(OTP_OUTCOME.EXPIRED)
  })

  it('invalidates the challenge at the attempt ceiling, not one guess later', async () => {
    const { challengeId, code } = await issue()
    const wrong = String((Number(code) + 1) % 10_000).padStart(4, '0')

    for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      const result = await verifyChallenge(app.pg, { challengeId, code: wrong, deviceId: DEVICE })
      expect(result.outcome).toBe(OTP_OUTCOME.INVALID)
      expect(result.attempts).toBe(attempt)
    }

    // The fifth wrong guess reaches the ceiling and burns the challenge.
    const final = await verifyChallenge(app.pg, { challengeId, code: wrong, deviceId: DEVICE })
    expect(final.outcome).toBe(OTP_OUTCOME.ATTEMPTS_EXCEEDED)

    // The ceiling is worthless if the *correct* code still works afterwards —
    // that would leave an attacker five free guesses per challenge forever.
    const afterCeiling = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE })
    expect(afterCeiling.outcome).not.toBe(OTP_OUTCOME.VERIFIED)

    const { rows } = await app.pg.query('SELECT consumed_at FROM otp_challenges WHERE id = $1', [challengeId])
    expect(rows[0].consumed_at).not.toBeNull()
  })

  it('expires five minutes after issue', async () => {
    const { challengeId, code, expiresAt } = await issue()
    expect(Math.round((expiresAt - Date.now()) / 1000)).toBeCloseTo(OTP_TTL_SECONDS, -1)

    // Verified against a clock past the expiry rather than by sleeping, so the
    // assertion is about the boundary and not about how fast CI happens to run.
    const justPast = new Date(new Date(expiresAt).getTime() + 1000)
    const result = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE, now: justPast })
    expect(result.outcome).toBe(OTP_OUTCOME.EXPIRED)
  })

  it('still honours a correct code one second BEFORE it expires', async () => {
    const { challengeId, code, expiresAt } = await issue()
    const justBefore = new Date(new Date(expiresAt).getTime() - 1000)
    const result = await verifyChallenge(app.pg, { challengeId, code, deviceId: DEVICE, now: justBefore })
    expect(result.outcome).toBe(OTP_OUTCOME.VERIFIED)
  })

  /**
   * §12.6 — the device mismatch is the subtle one.
   *
   * A distinct "wrong device" answer would let an attacker holding the code
   * learn which device the challenge belongs to, and probe a challenge from
   * anywhere, which is exactly what binding it to a device was meant to stop.
   * So the answer is `invalid`, indistinguishable from a wrong code.
   */
  it('answers a device mismatch as `invalid`, not as a distinct error', async () => {
    const { challengeId, code } = await issue()

    const mismatch = await verifyChallenge(app.pg, { challengeId, code, deviceId: 'some-other-device' })
    expect(mismatch.outcome).toBe(OTP_OUTCOME.INVALID)

    const wrongCode = await verifyChallenge(app.pg, {
      challengeId, code: String((Number(code) + 1) % 10_000).padStart(4, '0'), deviceId: DEVICE,
    })
    expect(mismatch.outcome).toBe(wrongCode.outcome)
  })

  it('counts a device mismatch against the same ceiling, so it cannot be probed freely', async () => {
    const { challengeId, code } = await issue()
    const first = await verifyChallenge(app.pg, { challengeId, code, deviceId: 'other' })
    expect(first.attempts).toBe(1)
  })

  it('treats an unknown challenge id as invalid rather than erroring', async () => {
    const result = await verifyChallenge(app.pg, {
      challengeId: '00000000-0000-0000-0000-000000000000', code: '1234', deviceId: DEVICE,
    })
    expect(result.outcome).toBe(OTP_OUTCOME.INVALID)
  })

  it('never stores the code in the clear', async () => {
    const { challengeId, code } = await issue()
    const { rows } = await app.pg.query('SELECT code_hash FROM otp_challenges WHERE id = $1', [challengeId])
    expect(Buffer.from(rows[0].code_hash).toString('utf8')).not.toContain(code)
    expect(Buffer.from(rows[0].code_hash).equals(hashCode(code, challengeId))).toBe(true)
  })
})
