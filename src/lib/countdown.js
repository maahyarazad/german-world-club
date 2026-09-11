/**
 * Countdown arithmetic, kept pure so it is testable without a clock or a DOM.
 *
 * Contract: specs/001-coming-soon-revamp/contracts/component-api.md (L1–L5)
 */

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The state the UI shows once the launch moment has arrived (or cannot be read). */
const LAUNCHED = Object.freeze({
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  total: 0,
  hasLaunched: true,
})

/** Normalises the accepted date forms to epoch milliseconds, or NaN. */
export function toEpochMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  if (typeof value === 'string') return new Date(value).getTime()
  return NaN
}

/**
 * Time remaining until `launchDate`, measured from `now`.
 *
 * Always returns non-negative integers. An unreadable date is treated as
 * already launched rather than surfacing NaN to the UI.
 *
 * @param {string|Date|number} launchDate ISO 8601 string (offset required), Date, or epoch ms
 * @param {number} [now] epoch ms; injectable so tests need no fake clock
 */
export function getTimeRemaining(launchDate, now = Date.now()) {
  const target = toEpochMs(launchDate)
  if (Number.isNaN(target)) return LAUNCHED

  const total = target - now
  if (total <= 0) return LAUNCHED

  return {
    days: Math.floor(total / DAY),
    hours: Math.floor((total % DAY) / HOUR),
    minutes: Math.floor((total % HOUR) / MINUTE),
    seconds: Math.floor((total % MINUTE) / SECOND),
    total,
    hasLaunched: false,
  }
}

export default getTimeRemaining
