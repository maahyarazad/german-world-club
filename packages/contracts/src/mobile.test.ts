import { describe, it, expect } from 'vitest'
import { checkMobile, isValidMobileE164, formatMobile } from './mobile.ts'

/** The shared mobile-number rule (feature 031). No DB, no network, no SMS. */
describe('checkMobile', () => {
  it('reads the reported input — a UAE number typed with its code but no + — as that number, and says so', () => {
    // Germany is the picker's default: this used to become +49971585831595.
    expect(checkMobile('DE', '971585831595')).toEqual({ ok: true, e164: '+971585831595', corrected: true })
    // With UAE picked it used to become +971971585831595. Here the library itself drops the
    // picked country's own code from the front, so the number is right and nothing needs saying.
    expect(checkMobile('AE', '971585831595')).toEqual({ ok: true, e164: '+971585831595', corrected: false })
  })

  it('accepts the same number however it is typed, without calling it a correction', () => {
    for (const [country, typed] of [['AE', '0585831595'], ['AE', '585831595'], ['AE', '058 583 1595'],
      ['DE', '+971 58 583 1595'], ['DE', '+971585831595'], ['DE', '00971585831595'], ['DE', '+971-58-583-1595']] as const) {
      expect(checkMobile(country, typed), `${country} ${typed}`).toEqual({ ok: true, e164: '+971585831595', corrected: false })
    }
  })

  it('never "corrects" a valid national number (counter-assertion)', () => {
    expect(checkMobile('DE', '0151 1234 5678')).toEqual({ ok: true, e164: '+4915112345678', corrected: false })
    expect(checkMobile('DE', '15112345678')).toEqual({ ok: true, e164: '+4915112345678', corrected: false })
    expect(checkMobile('AE', '50 123 4567')).toEqual({ ok: true, e164: '+971501234567', corrected: false })
  })

  it('refuses what is not a number, with a reason a form can show', () => {
    expect(checkMobile('DE', '')).toEqual({ ok: false, reason: 'empty' })
    expect(checkMobile('DE', '   ')).toEqual({ ok: false, reason: 'empty' })
    expect(checkMobile('DE', '12345')).toEqual({ ok: false, reason: 'too-short' })
    expect(checkMobile('DE', 'abc')).toEqual({ ok: false, reason: 'too-short' })
    expect(checkMobile('DE', '1'.repeat(20))).toEqual({ ok: false, reason: 'too-long' })
    // Right shape, not a number: the case the old regex let through.
    expect(checkMobile('DE', '9715858315')).toEqual({ ok: false, reason: 'invalid' })
    expect(checkMobile('DE', '+49971585831595')).toEqual({ ok: false, reason: 'invalid' })
  })

  it('refuses a landline, because a code can only be texted to a mobile', () => {
    expect(checkMobile('AE', '+97144123456')).toMatchObject({ ok: false })
    expect(checkMobile('DE', '030 123456')).toMatchObject({ ok: false })
  })

  it('works without a picked country when the number is international, and refuses a national one', () => {
    expect(checkMobile('', '+971585831595')).toEqual({ ok: true, e164: '+971585831595', corrected: false })
    expect(checkMobile('', '0585831595')).toMatchObject({ ok: false })
  })
})

describe('isValidMobileE164 (the server\'s check)', () => {
  it('accepts a real number and refuses the one from the bug report', () => {
    expect(isValidMobileE164('+971585831595')).toBe(true)
    expect(isValidMobileE164('+4915112345678')).toBe(true)
    expect(isValidMobileE164('+49971585831595')).toBe(false)
    expect(isValidMobileE164('+971971585831595')).toBe(false)
  })

  it('refuses anything that is not E.164, whatever it looks like', () => {
    for (const bad of ['971585831595', '', '+', '+abc', '0585831595', '+97144123456']) {
      expect(isValidMobileE164(bad), bad).toBe(false)
    }
  })
})

describe('formatMobile', () => {
  it('reads a number back the way people say it, and leaves anything else alone', () => {
    expect(formatMobile('+971585831595')).toBe('+971 58 583 1595')
    expect(formatMobile('not a number')).toBe('not a number')
  })
})
