import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { get, ApiError } from './api'
import { HOME_FOR_KIND } from '@gwc/contracts/capabilities'
import { PROBLEMS } from '@gwc/contracts/errors'
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
  /**
   * Signed in, but a membership application stands between this person and
   * the console (feature 009). Not FAILED — nothing is broken, and "reload the
   * page" would loop — and not ANONYMOUS, because they hold a valid session
   * that the application screen needs.
   */
  APPLICANT: 'applicant',
} as const)

/**
 * The refusals that mean "your application is not finished or not approved".
 * The server sends them from every member route to an applicant; the console
 * answers all three by showing the application, which reads the precise step
 * from /onboarding/status rather than guessing it from which refusal came.
 */
const APPLICANT_PROBLEMS: ReadonlySet<string> = new Set([
  PROBLEMS.APPROVAL_PENDING.type,
  PROBLEMS.PROFILE_INCOMPLETE.type,
  PROBLEMS.APPLICATION_DENIED.type,
])

/** The four states, as a union. "loading" and "anonymous" are not the same. */
export type Status = (typeof STATUS)[keyof typeof STATUS]

/**
 * Each audience has its own route: members `/auth/me`, staff `/auth/session`,
 * organisation principals `/auth/merchant/session` and `/auth/partner/session`.
 *
 * Separate routes because a route's audience is part of its posture: a member
 * token and a staff token can never satisfy each other's routes, by design,
 * and the same holds for the two organisation kinds. The console asks in order
 * of how common each principal is; the server's answer is what decides, not
 * the order.
 */
const SNAPSHOT_ROUTES: ReadonlyArray<readonly [string, (body: Record<string, unknown>) => Snapshot]> = [
  ['/auth/me', (body) => ({ ...body, kind: 'member', available: [] }) as Snapshot],
  ['/auth/session', (body) => body as Snapshot],
  ['/auth/merchant/session', (body) => body as Snapshot],
  ['/auth/partner/session', (body) => body as Snapshot],
]

async function fetchSnapshot(signal?: AbortSignal): Promise<Snapshot> {
  let last: unknown = null
  for (const [path, shape] of SNAPSHOT_ROUTES) {
    try {
      return shape((await get(path, { signal })) as Record<string, unknown>)
    } catch (error) {
      if (!(error instanceof ApiError)) throw error
      // Only "valid credential, wrong audience" means try the next route.
      // No credential, a revoked session or a locked account is the same
      // answer on every route, and asking the rest would only hide it.
      if (error.status !== 403 || error.needsSignIn || error.problem?.type !== PROBLEMS.INSUFFICIENT_PERMISSION.type) {
        throw error
      }
      last = error
    }
  }
  throw last
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
      const applicant = error instanceof ApiError && APPLICANT_PROBLEMS.has(error.problem?.type)
      setState({
        status: anonymous ? STATUS.ANONYMOUS : applicant ? STATUS.APPLICANT : STATUS.FAILED,
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
