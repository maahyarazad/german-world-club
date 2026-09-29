import { describe, it, expect, vi } from 'vitest'
import {
  createSmsCountryPolicy, normalizeDestination, maskDestination, BUILD_META,
} from '../../src/integrations/sms-country-policy.ts'

/**
 * The outbound SMS country policy, against the shipped tables.
 *
 * The precedence — denylist, then NANP area code, then allowlist — is the
 * property most worth pinning: steps 1 and 2 refuse destinations that ARE in
 * the business's accepted list, so a reordering keeps every happy path green
 * while silently admitting sanctioned and non-US +1 numbers.
 */
const policy = createSmsCountryPolicy()
const verdict = (n: string) => policy.resolveDestination(n)

describe('the shipped tables', () => {
  it('matches the generated build metadata', () => {
    expect(policy.activeCountries()).toHaveLength(BUILD_META.codeCount)
    expect([...policy.blockedCodes()].sort()).toEqual(['53', '850', '963', '98'])
  })
})

describe('resolveDestination', () => {
  it.each([
    ['+49 151 12345678', '49', 'Germany'],
    ['+971 50 123 4567', '971', 'UAE'],
    ['+351 912 345 678', '351', 'Azores'],
    ['+1 212 555 0100', '1', 'USA'],
    ['+1 787 555 0100', '1', 'USA'], // Puerto Rico: a US territory (R3)
  ])('allows %s', (number, dialingCode, name) => {
    expect(verdict(number)).toMatchObject({ allowed: true, reason: null, dialingCode, name })
  })

  it('refuses the sanctions denylist, even though those codes are known countries', () => {
    for (const number of ['+850 191 234 5678', '+53 5 123 4567', '+963 944 123 456', '+98 912 345 6789']) {
      expect(verdict(number), number).toMatchObject({ allowed: false, reason: 'country_blocked' })
    }
  })

  it('refuses +1 numbers outside the US area codes: Canada and the Caribbean', () => {
    expect(verdict('+1 416 555 0100')).toMatchObject({ allowed: false, reason: 'nanp_area_not_allowed' }) // Toronto
    expect(verdict('+1 876 555 0100')).toMatchObject({ allowed: false, reason: 'nanp_area_not_allowed' }) // Jamaica
    expect(verdict('+1 21')).toMatchObject({ allowed: false }) // no complete area code
  })

  it('names a known country it does not send to, and says so apart from an unknown one', () => {
    expect(verdict('+380 50 123 4567')).toMatchObject({ allowed: false, reason: 'country_not_allowed', dialingCode: '380' }) // Ukraine
    expect(verdict('+999 1234 5678')).toMatchObject({ allowed: false, reason: 'unknown_country', dialingCode: null })
  })

  it('refuses what it cannot parse rather than guessing', () => {
    for (const number of ['', 'call me', '+49 151 CALL', '123']) {
      expect(verdict(number), number).toMatchObject({ allowed: false, reason: 'unparseable' })
    }
  })

  it('strips one international access prefix, 00 or 011', () => {
    expect(verdict('0049 151 12345678')).toMatchObject({ allowed: true, dialingCode: '49' })
    expect(verdict('011 49 151 12345678')).toMatchObject({ allowed: true, dialingCode: '49' })
    expect(normalizeDestination('+49 (151) 123-456.78').digits).toBe('4915112345678')
  })

  it('never carries the full number in a decision', () => {
    const decision = verdict('+4915112345678')
    expect(decision.maskedDestination).toBe('*********5678')
    expect(JSON.stringify(verdict('+850 191 234 5678'))).not.toContain('8501912345678')
    expect(maskDestination('+49 151 1234 5678')).toBe('+** *** **** 5678')
  })
})

describe('configuration', () => {
  it('SMS_BLOCKED_COUNTRIES replaces the seed, and skips invalid entries without failing', () => {
    const warn = vi.fn()
    const custom = createSmsCountryPolicy({ blockedOverride: '49, oops ,0', warn })
    expect(custom.resolveDestination('+4915112345678')).toMatchObject({ allowed: false, reason: 'country_blocked' })
    expect(warn).toHaveBeenCalledTimes(2)
    // Replaced, not extended: North Korea is no longer on the denylist — and is
    // still refused, because it was never on the allowlist.
    expect(custom.resolveDestination('+850 191 234 5678')).toMatchObject({ allowed: false, reason: 'country_not_allowed' })
    // Counter-assertion: the shipped policy still allows Germany.
    expect(verdict('+4915112345678').allowed).toBe(true)
  })

  it('SMS_ALLOWED_COUNTRIES narrows by the start of the zone names', () => {
    const narrowed = createSmsCountryPolicy({ allowedFilter: 'ger' })
    expect(narrowed.resolveDestination('+4915112345678').allowed).toBe(true)
    expect(narrowed.resolveDestination('+33 6 12 34 56 78')).toMatchObject({ allowed: false, reason: 'country_not_allowed' })
    // The denylist still wins over a filter that happens to match.
    expect(createSmsCountryPolicy({ allowedFilter: 'n' }).resolveDestination('+850 191 234 5678').reason).toBe('country_blocked')
  })
})
