import { describe, expect, it } from 'vitest'
import { formatReferralCode, normaliseReferralCode } from './referrals.ts'

describe('normaliseReferralCode', () => {
  it('forgives case, spaces and hyphens', () => {
    for (const typed of ['abcd-efgh', 'ABCD EFGH', 'abcdefgh', ' AbCd-EfGh ']) {
      expect(normaliseReferralCode(typed)).toBe('ABCDEFGH')
    }
  })

  it('maps the confusable letters to the digit they are heard as', () => {
    expect(normaliseReferralCode('ILO0ABCD')).toBe('1100ABCD')
  })

  it('refuses anything that cannot be a code', () => {
    for (const typed of ['ABCDEFG', 'ABCDEFGHJ', 'ABCDEFGU', '', 'ABCD_EFG', null, undefined]) {
      expect(normaliseReferralCode(typed)).toBeNull()
    }
  })

  // Counter-assertion: a valid code is not merely "not null" but survives the
  // round trip through the display format unchanged.
  it('round-trips through the display format', () => {
    const formatted = formatReferralCode('7K3MXQ2T')
    expect(formatted).toBe('7K3M-XQ2T')
    expect(normaliseReferralCode(formatted)).toBe('7K3MXQ2T')
  })

  it('leaves something that is not a code as typed when formatting', () => {
    expect(formatReferralCode('nope')).toBe('nope')
  })
})
