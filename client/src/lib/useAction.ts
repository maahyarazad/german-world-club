import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from './api'

/**
 * Wrap a click handler that sends a request (feature 030).
 *
 *   const [save, saving] = useAction('EditProfile.save', async () => { await patch(…) })
 *   <Button loading={saving} onClick={() => void save()}>…</Button>
 *
 * Three things the plain `async` handler did not do:
 *
 *  - **Ignore a second press while one is running.** The guard is a ref set
 *    synchronously, not the `pending` state: state updates after the render, so
 *    two presses in the same frame would both have seen `pending === false` and
 *    sent two requests (two posts, two codes, two registrations).
 *  - **Say so.** `pending` drives the button's `loading`.
 *  - **Report failure the project's way.** A rejection is logged as
 *    `console.error(name, problem)` and swallowed; it is never stored as state or
 *    shown (CLAUDE.md). The documented exceptions that ARE shown — the sign-in
 *    refusal, `email-in-use` — pass `onError`, which replaces the log.
 */
export function useAction<A extends unknown[]>(
  name: string,
  fn: (...args: A) => Promise<unknown>,
  { onError }: { onError?: (error: unknown) => void } = {},
): [(...args: A) => Promise<void>, boolean] {
  const [pending, setPending] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)
  // The newest closure, so a handler that reads state is never stale.
  const latest = useRef({ fn, onError, name })
  latest.current = { fn, onError, name }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const run = useCallback(async (...args: A): Promise<void> => {
    if (running.current) return
    running.current = true
    setPending(true)
    try {
      await latest.current.fn(...args)
    } catch (error) {
      if (latest.current.onError) latest.current.onError(error)
      else console.error(latest.current.name, error instanceof ApiError ? error.problem : error)
    } finally {
      running.current = false
      if (mounted.current) setPending(false)
    }
  }, [])

  return [run, pending]
}
