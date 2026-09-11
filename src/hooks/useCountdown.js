import { useEffect, useState } from 'react'
import { getTimeRemaining, toEpochMs } from '../lib/countdown.js'

/**
 * Ticks the countdown once per second.
 *
 * The remaining time is derived during render rather than held in state: the
 * interval only forces a re-render, and every render recomputes from
 * `Date.now()`. That keeps three properties for free — a correct value on the
 * first render, an immediate update when `launchDate` changes, and no drift
 * when a background tab throttles the interval.
 *
 * `launchDate` is normalised to epoch milliseconds before being used as an
 * effect dependency. Depending on the raw value would re-run the effect on
 * every render whenever a caller passes a freshly constructed Date — a
 * natural thing to write, and an infinite render loop when compared by
 * reference.
 *
 * Contract: specs/001-coming-soon-revamp/contracts/component-api.md (H1–H5)
 */
export function useCountdown(launchDate) {
  const targetMs = toEpochMs(launchDate)
  const [, forceTick] = useState(0)

  const remaining = getTimeRemaining(targetMs)

  useEffect(() => {
    // Nothing left to count — don't open an interval at all (H4).
    if (getTimeRemaining(targetMs).hasLaunched) return undefined

    const id = setInterval(() => {
      forceTick((n) => n + 1)
      if (getTimeRemaining(targetMs).hasLaunched) clearInterval(id)
    }, 1000)

    return () => clearInterval(id)
    // NaN is a stable dependency: React compares with Object.is.
  }, [targetMs])

  return remaining
}

export default useCountdown
