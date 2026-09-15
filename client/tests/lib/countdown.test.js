import { describe, expect, it } from 'vitest'
import { getTimeRemaining } from '../../src/lib/countdown.js'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Contract: contracts/component-api.md (L1–L5) */
describe('getTimeRemaining', () => {
  const base = new Date('2026-01-01T00:00:00Z').getTime()

  it('computes a multi-unit remainder correctly', () => {
    const target = base + 3 * DAY + 4 * HOUR + 5 * MINUTE + 6 * SECOND
    expect(getTimeRemaining(target, base)).toMatchObject({
      days: 3,
      hours: 4,
      minutes: 5,
      seconds: 6,
      hasLaunched: false,
    })
  })

  it('L4: caps hours, minutes and seconds at their natural bounds', () => {
    const r = getTimeRemaining(base + 1 * DAY + 23 * HOUR + 59 * MINUTE + 59 * SECOND, base)
    expect(r.hours).toBeLessThanOrEqual(23)
    expect(r.minutes).toBeLessThanOrEqual(59)
    expect(r.seconds).toBeLessThanOrEqual(59)
  })

  it('L4: leaves days unbounded above', () => {
    expect(getTimeRemaining(base + 400 * DAY, base).days).toBe(400)
  })

  it('handles a sub-minute remainder', () => {
    expect(getTimeRemaining(base + 42 * SECOND, base)).toMatchObject({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 42,
      hasLaunched: false,
    })
  })

  it('spans a leap day correctly', () => {
    const feb27 = new Date('2028-02-27T00:00:00Z').getTime()
    const mar01 = new Date('2028-03-01T00:00:00Z').getTime()
    // 2028 is a leap year: 27 Feb -> 1 Mar is 3 days, not 2.
    expect(getTimeRemaining(mar01, feb27).days).toBe(3)
  })

  it('L2: treats the exact boundary as launched', () => {
    expect(getTimeRemaining(base, base)).toMatchObject({
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      total: 0,
      hasLaunched: true,
    })
  })

  it('L1/L2: returns zeros, never negatives, for a past date', () => {
    const r = getTimeRemaining(base - 10 * DAY, base)
    expect(r.hasLaunched).toBe(true)
    expect(r.total).toBe(0)
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      expect(r[unit]).toBe(0)
      expect(r[unit]).toBeGreaterThanOrEqual(0)
    }
  })

  it('L3: returns launched-with-zeros for unparseable input, never NaN', () => {
    for (const bad of ['not-a-date', '', null, undefined, {}]) {
      const r = getTimeRemaining(bad, base)
      expect(r.hasLaunched).toBe(true)
      expect(Number.isNaN(r.total)).toBe(false)
      expect(Number.isNaN(r.days)).toBe(false)
      expect(r.days).toBe(0)
    }
  })

  it('L5: returns integers for every unit', () => {
    const r = getTimeRemaining(base + 3 * DAY + 4 * HOUR + 5 * MINUTE + 6.7 * SECOND, base)
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      expect(Number.isInteger(r[unit])).toBe(true)
    }
  })

  it('accepts ISO strings, Date objects and epoch numbers alike', () => {
    const iso = '2026-01-04T00:00:00Z'
    const expected = getTimeRemaining(iso, base)
    expect(getTimeRemaining(new Date(iso), base)).toEqual(expected)
    expect(getTimeRemaining(new Date(iso).getTime(), base)).toEqual(expected)
  })

  it('respects the UTC offset in an ISO string', () => {
    // 09:00 +04:00 is 05:00 UTC — a 5 hour gap, not 9.
    const r = getTimeRemaining('2026-01-01T09:00:00+04:00', base)
    expect(r.hours).toBe(5)
  })

  it('is pure: same inputs always give the same output', () => {
    const target = base + 5 * DAY
    expect(getTimeRemaining(target, base)).toEqual(getTimeRemaining(target, base))
  })
})
