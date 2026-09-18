import { describe, it, expect } from 'vitest'
import {
  formatDate, formatDateTime, formatNumber, formatMoney, formatPercent,
  formatList, compareText, formattersFor,
} from '../src/lib/format.js'

/**
 * FR-006 — formatting follows the locale, not only the labels.
 *
 * Translating "Gültig bis" to "Valid until" and leaving `1.240,50 €` beside it
 * is the half-done version of a language switch. Every case below is a pair,
 * because a suite that only checked German would pass against a `format.js`
 * that ignored its locale argument entirely.
 */

const DATE = '2026-10-01T14:30:00.000Z'

describe('dates', () => {
  it('is day-first with dots in German, slashes in English', () => {
    expect(formatDate(DATE, 'de')).toBe('01.10.2026')
    expect(formatDate(DATE, 'en')).toBe('01/10/2026')
  })

  it('defaults to German when no locale is given', () => {
    expect(formatDate(DATE)).toBe(formatDate(DATE, 'de'))
  })

  it('formats a date and time in both', () => {
    expect(formatDateTime(DATE, 'de')).not.toBe(formatDateTime(DATE, 'en'))
    expect(formatDateTime(DATE, 'de')).toMatch(/^01\.10\.2026/)
    expect(formatDateTime(DATE, 'en')).toMatch(/^01\/10\/2026/)
  })

  it('returns empty for a value that is not a date, in both', () => {
    for (const locale of ['de', 'en']) {
      expect(formatDate(null, locale)).toBe('')
      expect(formatDate('not a date', locale)).toBe('')
    }
  })
})

describe('numbers and money', () => {
  it('swaps the thousands and decimal separators', () => {
    expect(formatNumber(1240.5, 'de')).toBe('1.240,5')
    expect(formatNumber(1240.5, 'en')).toBe('1,240.5')
  })

  it('puts the euro sign where each locale puts it', () => {
    // 1.240,50 € against €1,240.50 — the same amount, and the reason FR-006
    // names formatting separately from translation.
    expect(formatMoney(124050, 'EUR', 'de')).toMatch(/1\.240,50/)
    expect(formatMoney(124050, 'EUR', 'en')).toMatch(/1,240\.50/)
    expect(formatMoney(124050, 'EUR', 'de')).not.toBe(formatMoney(124050, 'EUR', 'en'))
  })

  it('handles a currency that is not the euro, in both', () => {
    for (const locale of ['de', 'en']) {
      expect(formatMoney(35000, 'AED', locale)).toMatch(/350/)
      expect(formatMoney(50000, 'USD', locale)).toMatch(/500/)
    }
  })

  it('divides minor units exactly once', () => {
    // Amounts cross the wire as integer cents because a float cannot represent
    // them exactly. This is the only place that conversion happens.
    expect(formatMoney(1, 'EUR', 'en')).toMatch(/0\.01/)
  })

  it('formats a percentage in both', () => {
    expect(formatPercent(0.92, 'de')).toMatch(/92/)
    expect(formatPercent(0.92, 'en')).toMatch(/92/)
  })

  it('returns empty for a non-number, in both', () => {
    for (const locale of ['de', 'en']) {
      expect(formatNumber('x', locale)).toBe('')
      expect(formatMoney(undefined, 'EUR', locale)).toBe('')
    }
  })
})

describe('lists and sorting', () => {
  it('joins a list with the right conjunction', () => {
    expect(formatList(['a', 'b', 'c'], 'de')).toMatch(/und/)
    expect(formatList(['a', 'b', 'c'], 'en')).toMatch(/and/)
  })

  it('sorts umlauts with their base letter in German', () => {
    // An English collator puts "Ärztin" after "Zürich" instead of beside "Arzt".
    const words = ['Zürich', 'Ärztin', 'Arzt']
    const sorted = [...words].sort((a, b) => compareText(a, b, 'de'))
    expect(sorted[sorted.length - 1]).toBe('Zürich')
  })

  it('returns empty for an empty list, in both', () => {
    for (const locale of ['de', 'en']) {
      expect(formatList([], locale)).toBe('')
      expect(formatList(null, locale)).toBe('')
    }
  })
})

describe('formattersFor binds one locale', () => {
  it('produces the same output as the free functions', () => {
    const en = formattersFor('en')
    const de = formattersFor('de')
    expect(en.date(DATE)).toBe(formatDate(DATE, 'en'))
    expect(de.money(124050, 'EUR')).toBe(formatMoney(124050, 'EUR', 'de'))
    expect(en.locale).toBe('en')
  })

  it('returns different output for the two locales', () => {
    // Counter-assertion: a `formattersFor` that ignored its argument would pass
    // every test above that only checked one locale.
    expect(formattersFor('de').date(DATE)).not.toBe(formattersFor('en').date(DATE))
  })

  it('falls back to German for an unknown locale rather than throwing', () => {
    expect(formatDate(DATE, 'fr')).toBe(formatDate(DATE, 'de'))
  })
})
