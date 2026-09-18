import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { get, ApiError } from './api.js'
import { HOME_FOR_KIND } from '@gwc/contracts/capabilities'

/**
 * The capability snapshot, fetched and kept fresh.
 *
 * Three rules this module exists to enforce, all from
 * specs/003-web-console/contracts/capability-api.md:
 *
 *   1. It decides what to *display*. It never decides what is *allowed* — the
 *      server re-checks every operation, and a client that treated this as the
 *      barrier would be the only barrier.
 *   2. It is re-fetched after any refusal that implies it is stale. A grant can
 *      be revoked between the sidebar rendering and the click that follows it.
 *   3. It never falls back to a default. A failed fetch renders an error, not a
 *      guess — a console that guessed would show a sidebar nobody granted.
 */

const CapabilityContext = createContext(null)

/** Distinguishes "not fetched yet" from "fetched, and the answer is nothing". */
export const STATUS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ANONYMOUS: 'anonymous',
  FAILED: 'failed',
})

/**
 * Members come from `/auth/me`, everyone else from `/auth/session`.
 *
 * Two routes because they are two audiences: a member token and a staff token
 * can never satisfy each other's routes, by design. The console tries the
 * member route first only because it is the cheaper guess for the common case;
 * the server's answer is what decides, not the order.
 */
async function fetchSnapshot(signal) {
  try {
    const member = await get('/auth/me', { signal })
    return { ...member, kind: 'member', available: [] }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    // 401 means no credential at all — stop, do not try the other route.
    if (error.status === 401) throw error
    // 403 here means "valid credential, wrong audience", i.e. not a member.
    // Fall through and ask the staff/organisation route.
  }
  return get('/auth/session', { signal })
}

export function CapabilityProvider({ children }) {
  const [state, setState] = useState({ status: STATUS.LOADING, snapshot: null, error: null })

  const refresh = useCallback(async (signal) => {
    setState((previous) => ({ ...previous, status: STATUS.LOADING }))
    try {
      const snapshot = await fetchSnapshot(signal)
      setState({ status: STATUS.READY, snapshot, error: null })
      return snapshot
    } catch (error) {
      if (error?.name === 'AbortError') return null
      const anonymous = error instanceof ApiError && error.needsSignIn
      setState({
        status: anonymous ? STATUS.ANONYMOUS : STATUS.FAILED,
        snapshot: null,
        error: error instanceof ApiError ? error : null,
      })
      return null
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  const clear = useCallback(() => {
    setState({ status: STATUS.ANONYMOUS, snapshot: null, error: null })
  }, [])

  return (
    <CapabilityContext.Provider value={{ ...state, refresh, clear }}>
      {children}
    </CapabilityContext.Provider>
  )
}

export function useCapabilities() {
  const context = useContext(CapabilityContext)
  if (!context) throw new Error('useCapabilities must be used inside a CapabilityProvider')
  return context
}

/**
 * Report a refusal to the capability layer.
 *
 * Call this from anywhere a request was refused. When the refusal implies our
 * snapshot is stale, it re-fetches — which is what makes a revoked grant
 * disappear from the sidebar on the very next interaction rather than at the
 * next full page load (FR-016).
 */
export function useRefusalHandler() {
  const { refresh, clear } = useCapabilities()
  return useCallback(
    (error) => {
      if (!(error instanceof ApiError)) return
      if (error.needsSignIn) {
        clear()
        return
      }
      if (error.capabilitiesStale) refresh()
    },
    [refresh, clear],
  )
}

export const homeFor = (kind) => HOME_FOR_KIND[kind] ?? HOME_FOR_KIND.member
