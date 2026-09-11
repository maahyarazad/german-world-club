import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCountdown } from '../../src/hooks/useCountdown.js'

const SECOND = 1000
const NOW = new Date('2026-01-01T00:00:00Z').getTime()

/**
 * Contract: contracts/component-api.md (H1–H5)
 *
 * NOTE: these tests drive the clock with a `Date.now` spy and let the real
 * interval run, rather than using `vi.useFakeTimers()`. Spying on `Date.now`
 * keeps the hook deterministic without replacing the scheduling primitives
 * React's `act` depends on, and it keeps each test to a single real tick.
 *
 * Several of these pass a freshly constructed `Date` on every render. That is
 * deliberate: it is the natural way to call the hook, and it used to spin the
 * effect in an infinite loop until the hook was changed to depend on the
 * normalised epoch value rather than the object's identity.
 */
describe('useCountdown', () => {
  afterEach(() => vi.restoreAllMocks())

  /** Pins the clock and returns a setter to move it. */
  function pinClock(at = NOW) {
    let current = at
    vi.spyOn(Date, 'now').mockImplementation(() => current)
    return (next) => {
      current = next
    }
  }

  it('H1: returns the correct value on first render, with no flash of zeros', () => {
    pinClock()
    const { result } = renderHook(() => useCountdown(new Date(NOW + 90 * SECOND)))

    expect(result.current.hasLaunched).toBe(false)
    expect(result.current.minutes).toBe(1)
    expect(result.current.seconds).toBe(30)
  })

  it('advances as the clock moves', async () => {
    const setClock = pinClock()
    const { result } = renderHook(() => useCountdown(new Date(NOW + 10 * SECOND)))
    expect(result.current.seconds).toBe(10)

    setClock(NOW + 3 * SECOND)
    await waitFor(() => expect(result.current.seconds).toBe(7), { timeout: 3000 })
  })

  it('H2: recomputes from wall-clock time, so a throttled tab stays accurate', async () => {
    const setClock = pinClock()
    const { result } = renderHook(() => useCountdown(new Date(NOW + 600 * SECOND)))

    // A backgrounded tab: five minutes of real time pass while the interval
    // fires far fewer times than once per second. A hook that decremented a
    // held counter would now be minutes behind.
    setClock(NOW + 300 * SECOND)

    await waitFor(
      () => {
        expect(result.current.minutes).toBe(5)
        expect(result.current.seconds).toBe(0)
      },
      { timeout: 3000 },
    )
  })

  it('H3: clears its interval on unmount', () => {
    pinClock()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useCountdown(new Date(NOW + 60 * SECOND)))

    unmount()
    expect(clearSpy).toHaveBeenCalled()
  })

  it('H4: opens no interval at all when the date has already passed', () => {
    pinClock()
    const intervalSpy = vi.spyOn(globalThis, 'setInterval')
    const { result } = renderHook(() => useCountdown(new Date(NOW - 10 * SECOND)))

    expect(result.current.hasLaunched).toBe(true)
    expect(intervalSpy).not.toHaveBeenCalled()
  })

  it('H4: stops ticking once the launch moment passes', async () => {
    const setClock = pinClock()
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const { result } = renderHook(() => useCountdown(new Date(NOW + 2 * SECOND)))
    expect(result.current.hasLaunched).toBe(false)

    setClock(NOW + 3 * SECOND)
    await waitFor(() => expect(result.current.hasLaunched).toBe(true), { timeout: 3000 })
    expect(clearSpy).toHaveBeenCalled()
  })

  it('H4: never yields a negative value after launch', () => {
    pinClock()
    const { result } = renderHook(() => useCountdown(new Date(NOW - 5000 * SECOND)))

    expect(result.current.hasLaunched).toBe(true)
    for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
      expect(result.current[unit]).toBe(0)
    }
  })

  it('H5: restarts against a new launchDate when it changes', () => {
    pinClock()
    const { result, rerender } = renderHook(({ d }) => useCountdown(d), {
      initialProps: { d: new Date(NOW + 10 * SECOND) },
    })
    expect(result.current.seconds).toBe(10)

    rerender({ d: new Date(NOW + 45 * SECOND) })
    expect(result.current.seconds).toBe(45)
  })

  it('treats an unparseable date as already launched', () => {
    pinClock()
    const { result } = renderHook(() => useCountdown('not-a-date'))
    expect(result.current.hasLaunched).toBe(true)
  })
})
