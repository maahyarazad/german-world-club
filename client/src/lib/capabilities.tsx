import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { get, ApiError } from './api'
import { HOME_FOR_KIND } from '@gwc/contracts/capabilities'
import type { ConsoleKind, GrantSnapshot } from '@gwc/contracts/capabilities'
import type { ReactNode } from 'react'

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

/**
 * The snapshot as the console holds it.
 *
 * Deliberately loose about its payload: after feature 007 nothing validates
 * the response at runtime, so a narrow type here would be a claim the wire
 * cannot honour. What the console actually branches on — `kind`, `modules`,
 * `available` — is typed; the rest is carried through untouched.
 */
export type Snapshot = NonNullable<GrantSnapshot> & {
  kind: ConsoleKind
  displayName?: string | null
  /** Bypasses the module matrix entirely. Resolved by the server, never here. */
  isSuperadmin?: boolean
  /** Whatever else the payload carries; nothing validates it after 007. */
  [key: string]: unknown
}

export type CapabilityState = {
  status: Status
  snapshot: Snapshot | null
  error: ApiError | null
}

export type CapabilityContextValue = CapabilityState & {
  refresh: (signal?: AbortSignal) => Promise<Snapshot | null>
  clear: () => void
}

const CapabilityContext = createContext<CapabilityContextValue | null>(null)

/** Distinguishes "not fetched yet" from "fetched, and the answer is nothing". */
export const STATUS = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  ANONYMOUS: 'anonymous',
  FAILED: 'failed',
} as const)

/** The four states, as a union. "loading" and "anonymous" are not the same. */
export type Status = (typeof STATUS)[keyof typeof STATUS]

/**
 * Members come from `/auth/me`, everyone else from `/auth/session`.
 *
 * Two routes because they are two audiences: a member token and a staff token
 * can never satisfy each other's routes, by design. The console tries the
 * member route first only because it is the cheaper guess for the common case;
 * the server's answer is what decides, not the order.
 */
async function fetchSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  try {
    const member = (await get('/auth/me', { signal })) as Record<string, unknown>
    return { ...member, kind: 'member', available: [] } as Snapshot
  } catch (error) {
    if (!(error instanceof ApiError)) throw error
    // 401 means no credential at all — stop, do not try the other route.
    if (error.status === 401) throw error
    // 403 here means "valid credential, wrong audience", i.e. not a member.
    // Fall through and ask the staff/organisation route.
  }
  return (await get('/auth/session', { signal })) as Snapshot
}

export function CapabilityProvider({ children }: { children?: ReactNode }) {
  const [state, setState] = useState<CapabilityState>({
    status: STATUS.LOADING,
    snapshot: null,
    error: null,
  })

  const refresh = useCallback(async (signal?: AbortSignal): Promise<Snapshot | null> => {
    setState((previous) => ({ ...previous, status: STATUS.LOADING }))
    try {
      const snapshot = await fetchSnapshot(signal)
      setState({ status: STATUS.READY, snapshot, error: null })
      return snapshot
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return null
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

export function useCapabilities(): CapabilityContextValue {
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
export function useRefusalHandler(): (error: unknown) => void {
  const { refresh, clear } = useCapabilities()
  return useCallback(
    (error: unknown) => {
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

export const homeFor = (kind: ConsoleKind | undefined): string =>
  (kind ? HOME_FOR_KIND[kind] : undefined) ?? HOME_FOR_KIND.member
