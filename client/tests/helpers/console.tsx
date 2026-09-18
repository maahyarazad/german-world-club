import type { ReactNode } from 'react'
import type { Flag, Module } from '@gwc/contracts/permissions'
import type { Locale } from '../../src/i18n/locales'
import { vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CapabilityProvider } from '../../src/lib/capabilities'
import { LocaleProvider } from '../../src/i18n/index'
import { FLAGS, MODULES } from '@gwc/contracts/permissions'

/**
 * Scaffolding for the console suites.
 *
 * The snapshot is delivered the way the real one is — over fetch, from
 * /auth/session — rather than injected into the context directly. A test that
 * stubbed the context would pass against a console whose fetching was broken,
 * and the fetching is half of what these suites are checking.
 */

/** A staff snapshot holding exactly the grants named. */
/** `true` means every flag; otherwise name the flags that are held. */
export type GrantSpec = Record<string, true | Partial<Record<Flag, boolean>>>

export type StaffSnapshotOptions = {
  grants?: GrantSpec
  available?: readonly Module[] | null
  isSuperadmin?: boolean
}

export function staffSnapshot({ grants = {}, available = null, isSuperadmin = false }: StaffSnapshotOptions = {}) {
  const modules: Record<string, Record<Flag, boolean>> = {}
  for (const [module, flags] of Object.entries(grants)) {
    const set: Partial<Record<Flag, boolean>> =
      flags === true ? Object.fromEntries(FLAGS.map((f) => [f, true])) : flags
    modules[module] = Object.fromEntries(FLAGS.map((f) => [f, set[f] === true])) as Record<Flag, boolean>
  }
  return {
    kind: 'staff',
    id: '00000000-0000-4000-8000-000000000001',
    displayName: 'Test Staff',
    isSuperadmin,
    modules,
    // Default: every module the principal holds is servable. Tests that care
    // about the "noch nicht verfügbar" path pass an explicit list.
    available: available ?? Object.keys(modules),
  }
}

export const memberSnapshot = () => ({
  kind: 'member',
  id: '00000000-0000-4000-8000-000000000002',
  displayName: 'Test Member',
  emailConfirmed: true,
  permissions: [],
  entitlement: null,
  available: [],
})

const problem = (type: string, status: number) => ({
  body: JSON.stringify({ type, title: type, status }),
  status,
  headers: { 'content-type': 'application/problem+json' },
})

/**
 * Stub fetch for the two capability routes.
 *
 * `/auth/me` answers 403 for a non-member so the provider falls through to
 * `/auth/session`, which is exactly what the real server does: a staff token on
 * a member route fails its audience check.
 */
/** What an extraRoutes handler returns: a raw Response body plus its metadata. */
export type RouteResult = { body?: BodyInit | null; status?: number; headers?: HeadersInit }
export type RouteHandler = (options: RequestInit) => RouteResult | Promise<RouteResult>

export function mockCapabilityFetch(
  snapshot: { kind?: string } | null | undefined,
  { extraRoutes = {} }: { extraRoutes?: Record<string, RouteHandler> } = {},
) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, options: RequestInit = {}) => {
    const path = String(url)

    // Every unsafe request fetches one of these first, so a helper that did not
    // serve it would make each test exercise the CSRF failure path instead of
    // whatever it meant to test.
    if (path === '/auth/csrf') {
      return new Response(JSON.stringify({ csrfToken: 'test-csrf-token' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    for (const [route, handler] of Object.entries(extraRoutes)) {
      if (path === route || path.startsWith(`${route}?`)) {
        const result = await handler(options)
        return new Response(result.body ?? null, {
          status: result.status ?? 200,
          headers: result.headers ?? { 'content-type': 'application/json' },
        })
      }
    }

    if (path === '/auth/me') {
      if (snapshot?.kind === 'member') {
        return new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      const p = snapshot
        ? problem('https://german-world-club.com/problems/insufficient-permission', 403)
        : problem('https://german-world-club.com/problems/unauthenticated', 401)
      return new Response(p.body, { status: p.status, headers: p.headers })
    }

    if (path === '/auth/session') {
      if (!snapshot) {
        const p = problem('https://german-world-club.com/problems/unauthenticated', 401)
        return new Response(p.body, { status: p.status, headers: p.headers })
      }
      return new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response(null, { status: 204 })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Render inside the providers and a router, at `route`.
 *
 * `locale` defaults to German so every suite written before the language switch
 * keeps asserting what it always did. A suite that cares about English passes
 * it explicitly, which also makes the intent visible at the call site.
 */
export type RenderConsoleOptions = { route?: string; locale?: Locale }

export function renderConsole(ui: ReactNode, { route = '/konsole/admin', locale = 'de' }: RenderConsoleOptions = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <LocaleProvider initialLocale={locale}>
        <CapabilityProvider>{ui}</CapabilityProvider>
      </LocaleProvider>
    </MemoryRouter>,
  )
}

export { FLAGS, MODULES }
