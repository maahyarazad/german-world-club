import { useEffect, useState } from 'react'

/**
 * `true` only once `active` has been continuously true for `ms`.
 *
 * A loader that flashes on for 40 ms is worse than none: the page jumps and the
 * user sees a flicker they cannot read. A response that arrives within the
 * grace period therefore shows nothing at all (feature 030, FR-005). It drops to
 * `false` the moment `active` does, and clears its timer on unmount.
 */
export function useGrace(active: boolean, ms = 150): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!active) {
      setShown(false)
      return undefined
    }
    const timer = setTimeout(() => setShown(true), ms)
    return () => clearTimeout(timer)
  }, [active, ms])

  return active && shown
}
