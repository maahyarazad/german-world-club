import { describe, it, expect } from 'vitest'
import { labelForWeb, labelForPhone } from '../../src/modules/auth/device-label.ts'

describe('device labels (feature 026)', () => {
  const cases: Array<[string, string]> = [
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', 'Chrome on macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', 'Safari on iOS'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0', 'Firefox on Windows'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36 Edg/124.0', 'Edge on Windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36', 'Chrome on Android'],
  ]
  it.each(cases)('names %#', (ua, expected) => {
    expect(labelForWeb(ua)).toBe(expected)
  })

  it('falls back for an empty or unrecognisable agent, never echoing it', () => {
    expect(labelForWeb('')).toBe('Web browser')
    expect(labelForWeb(null)).toBe('Web browser')
    expect(labelForWeb('curl/8.0 SECRET-BUILD-1234')).toBe('Web browser')
  })

  it('trims, caps and cleans what a phone reports', () => {
    expect(labelForPhone('  iPhone 15  ')).toBe('iPhone 15')
    expect(labelForPhone('x'.repeat(200))).toHaveLength(64)
    expect(labelForPhone('Pixel\n8\u0000')).toBe('Pixel 8')
    expect(labelForPhone(undefined)).toBe('Phone')
    expect(labelForPhone('   ')).toBe('Phone')
  })
})
