import { describe, it, expect } from 'vitest'
import { COUNTRIES } from '../src/countries.ts'
import { DIAL_CODES, hasDialCode, toE164, splitE164, dialLabel } from '../src/dial-codes.ts'
import { registerRequestSchema } from '../src/onboarding.ts'

const E164 = registerRequestSchema.shape.mobile

describe('dial codes', () => {
  it('covers every residence country except the six with no telephone service', () => {
    const missing = COUNTRIES.filter((c) => !hasDialCode(c.code)).map((c) => c.code).sort()
    expect(missing).toEqual(['AQ', 'BV', 'GS', 'HM', 'TF', 'UM'])
    expect(Object.keys(DIAL_CODES).every((code) => COUNTRIES.some((c) => c.code === code))).toBe(true)
  })

  it('builds an E.164 number the server accepts', () => {
    expect(toE164('DE', '151 1234 5678')).toBe('+4915112345678')
    expect(E164.safeParse(toE164('DE', '151 1234 5678')).success).toBe(true)
    expect(toE164('DE', '0151-1234-5678')).toBe('+4915112345678') // the national trunk zero is dropped
    expect(toE164('US', '(415) 555-0100')).toBe('+14155550100')
    expect(toE164('AE', '50 123 4567')).toBe('+971501234567')
  })

  it('lets a number typed with its own prefix win over the picked country', () => {
    expect(toE164('DE', '+44 20 7946 0958')).toBe('+442079460958')
    expect(toE164('DE', '0044 20 7946 0958')).toBe('+442079460958')
  })

  it('restores a saved number into a country and the rest, longest calling code first', () => {
    expect(splitE164('+4915112345678')).toEqual({ country: 'DE', national: '15112345678' })
    expect(splitE164('+971501234567')).toEqual({ country: 'AE', national: '501234567' })
    expect(splitE164('+14155550100')).toEqual({ country: 'US', national: '4155550100' })
    expect(splitE164('+442079460958')?.country).toBe('GB')
    expect(splitE164('4915112345678')).toBeNull()
  })

  it('labels a country with its code in the interface language', () => {
    expect(dialLabel('DE', 'en')).toBe('Germany (+49)')
    expect(dialLabel('AT', 'de')).toBe('Österreich (+43)')
  })
})
