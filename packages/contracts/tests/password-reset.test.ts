import { describe, it, expect } from 'vitest'
import { PASSWORD_RESET_CODE_LENGTH } from '../src/auth.ts'
import {
  passwordResetCodeRequestSchema,
  passwordResetCodeAcceptedSchema,
  passwordResetCodeConfirmSchema,
} from '../src/password-reset.ts'

/**
 * Feature 043: resetting a forgotten password by an SMS code, from the app.
 *
 * These are the shapes both the server's route schemas and the app import, so a
 * field renamed here is a type error everywhere (the contracts package's whole
 * purpose). The server re-checks every request; the app uses them to refuse an
 * obviously wrong form before spending a request, and, for the code, before
 * spending one of the five guesses a code allows.
 */
const DEVICE = 'device-1'
const UUID = '8f14e45f-ceea-4e67-9c5a-0a1b2c3d4e5f'

const ask = (v: unknown) => passwordResetCodeRequestSchema.safeParse(v)
const confirm = (v: unknown) => passwordResetCodeConfirmSchema.safeParse(v)

describe('the reset code length', () => {
  it('is six digits (spec decision 3)', () => {
    expect(PASSWORD_RESET_CODE_LENGTH).toBe(6)
  })
})

describe('asking for a reset code', () => {
  it('accepts an email and a device', () => {
    expect(ask({ email: 'member@example.test', deviceId: DEVICE }).success).toBe(true)
  })

  it('accepts a mobile number in international form and a device', () => {
    expect(ask({ mobile: '+4915112345678', deviceId: DEVICE }).success).toBe(true)
  })

  it('refuses both identifiers together: it must be one or the other', () => {
    expect(ask({ email: 'member@example.test', mobile: '+4915112345678', deviceId: DEVICE }).success).toBe(false)
  })

  it('refuses neither identifier', () => {
    expect(ask({ deviceId: DEVICE }).success).toBe(false)
  })

  it('refuses a key it does not know (strict), so a typo is not silently ignored', () => {
    expect(ask({ email: 'member@example.test', deviceId: DEVICE, extra: 1 }).success).toBe(false)
    expect(ask({ mobile: '+4915112345678', deviceId: DEVICE, email: undefined, nope: true }).success).toBe(false)
  })

  it('refuses something that is not an email', () => {
    expect(ask({ email: 'not-an-email', deviceId: DEVICE }).success).toBe(false)
  })

  it('refuses a number with the right shape that is not a number (feature 031)', () => {
    // The shape-right-but-not-a-number example from feature 031: the SMS provider
    // refused it and the server called that an outage.
    expect(ask({ mobile: '+49971585831595', deviceId: DEVICE }).success).toBe(false)
    // Counter-assertion: a real number of the same country is fine, so the check is the number, not the country.
    expect(ask({ mobile: '+4915112345678', deviceId: DEVICE }).success).toBe(true)
  })

  it('refuses a number without its country code', () => {
    expect(ask({ mobile: '015112345678', deviceId: DEVICE }).success).toBe(false)
  })

  it('requires a device, at most 128 characters', () => {
    expect(ask({ email: 'member@example.test' }).success).toBe(false)
    expect(ask({ email: 'member@example.test', deviceId: '' }).success).toBe(false)
    expect(ask({ email: 'member@example.test', deviceId: 'x'.repeat(128) }).success).toBe(true)
    expect(ask({ email: 'member@example.test', deviceId: 'x'.repeat(129) }).success).toBe(false)
  })
})

describe('the answer to asking', () => {
  it('is requested, a challenge id and the cooldown, and nothing else that could say who matched', () => {
    const answer = { requested: true, challengeId: UUID, cooldownSeconds: 60 }
    expect(passwordResetCodeAcceptedSchema.safeParse(answer).success).toBe(true)
    // Counter-assertion: the id must be a uuid and the flag literally true.
    expect(passwordResetCodeAcceptedSchema.safeParse({ ...answer, challengeId: 'abc' }).success).toBe(false)
    expect(passwordResetCodeAcceptedSchema.safeParse({ ...answer, requested: false }).success).toBe(false)
    expect(passwordResetCodeAcceptedSchema.safeParse({ ...answer, cooldownSeconds: -1 }).success).toBe(false)
  })
})

describe('confirming a reset code with a new password', () => {
  const good = { challengeId: UUID, code: '123456', deviceId: DEVICE, password: 'Correct-Horse-9' }

  it('accepts a six-digit code and a password of 8 to 256 characters', () => {
    expect(confirm(good).success).toBe(true)
    expect(confirm({ ...good, password: 'x'.repeat(8) }).success).toBe(true)
    expect(confirm({ ...good, password: 'x'.repeat(256) }).success).toBe(true)
  })

  it('refuses a code that is not exactly six digits', () => {
    for (const code of ['1234', '12345', '1234567', '12345a', '12 456', '']) {
      expect(confirm({ ...good, code }).success, `code ${JSON.stringify(code)}`).toBe(false)
    }
  })

  it('refuses a password shorter than 8 or longer than 256 characters', () => {
    expect(confirm({ ...good, password: 'x'.repeat(7) }).success).toBe(false)
    expect(confirm({ ...good, password: 'x'.repeat(257) }).success).toBe(false)
  })

  it('refuses a challenge id that is not a uuid, and a missing device', () => {
    expect(confirm({ ...good, challengeId: 'abc' }).success).toBe(false)
    expect(confirm({ challengeId: UUID, code: '123456', password: 'Correct-Horse-9' }).success).toBe(false)
  })
})
