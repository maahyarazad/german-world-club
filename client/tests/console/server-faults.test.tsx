import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within, cleanup } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { t as en } from '../../src/i18n/en'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * The console's Fehlerprotokoll (feature 012, US3, contracts/server-faults-api.md).
 *
 * Read-only: find a fault by the id a member read out, or scan the recent
 * ones. Stored messages and stacks are server English and are shown exactly as
 * recorded in either language.
 */

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})
const problem = (p: { type: string; status: number; title: string }) => ({
  body: JSON.stringify({ type: p.type, title: p.title, status: p.status }),
  status: p.status,
  headers: { 'content-type': 'application/problem+json' },
})

const FP_A = 'a'.repeat(64)
const summary = (n: number, fingerprint = FP_A) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  occurredAt: `2026-09-24T10:0${n}:00.000Z`,
  requestId: `01J8Z3K2QX000000000000000${n}`,
  clientRequestId: null,
  method: 'GET', route: '/member/events/:id', status: 500,
  errorName: 'TypeError', errorCode: null, message: `Cannot read properties of undefined (${n})`,
  principalKind: null, principalId: null, fingerprint,
})
const STACK = 'TypeError: Cannot read properties of undefined\n    at loadEvent (modules/events/application/read.ts)'

function routes(overrides: Record<string, RouteHandler> = {}) {
  return {
    '/admin/server-faults': () => json({ items: [summary(2), summary(1)], nextCursor: null, suppressedLast24h: 0 }),
    ...overrides,
  }
}

const reader = () => staffSnapshot({ grants: { server_faults: { read: true } } })

async function open(locale: 'de' | 'en' = 'de') {
  renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/fehlerprotokoll', locale })
  const title = locale === 'de' ? t.serverFaults.pageTitle : en.serverFaults.pageTitle
  await waitFor(() => expect(screen.getAllByText(title).length).toBeGreaterThan(0))
}

const calls = (fetchMock: ReturnType<typeof mockCapabilityFetch>, prefix: string) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.startsWith(prefix))

describe('the Fehlerprotokoll', () => {
  it('appears in the sidebar only for a holder of server_faults', async () => {
    mockCapabilityFetch(reader(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })
    await waitFor(() => expect(screen.getByRole('link', { name: t.modules.server_faults })).toBeInTheDocument())

    // Unmount the first render, or it is still in the DOM below.
    cleanup()
    vi.unstubAllGlobals()
    // Counter-assertion: the entry is a projection of the grant, not always there.
    mockCapabilityFetch(staffSnapshot({ grants: { members: true } }), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })
    await waitFor(() => expect(screen.getAllByRole('link').length).toBeGreaterThan(0))
    expect(screen.queryByRole('link', { name: t.modules.server_faults })).not.toBeInTheDocument()
  })

  it('lists recent faults and loads older ones with the cursor', async () => {
    const fetchMock = mockCapabilityFetch(reader(), {
      extraRoutes: routes({
        '/admin/server-faults': () => json({ items: [summary(2)], nextCursor: 'CURSOR1', suppressedLast24h: 0 }),
      }),
    })
    await open()
    await waitFor(() => expect(screen.getByText(summary(2).message)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: t.serverFaults.loadOlder }))
    await waitFor(() => expect(calls(fetchMock, '/admin/server-faults?').some((u) => u.includes('before=CURSOR1'))).toBe(true))
  })

  it('filters by a fault\'s fingerprint', async () => {
    const fetchMock = mockCapabilityFetch(reader(), { extraRoutes: routes() })
    await open()
    await waitFor(() => expect(screen.getByText(summary(2).message)).toBeInTheDocument())
    fireEvent.click(screen.getAllByRole('button', { name: t.serverFaults.filterByFault })[0]!)
    await waitFor(() => expect(calls(fetchMock, '/admin/server-faults?').some((u) => u.includes(`fingerprint=${FP_A}`))).toBe(true))
    expect(screen.getByRole('button', { name: t.serverFaults.clearFilter })).toBeInTheDocument()
  })

  it('finds a fault by request id and shows its stack verbatim', async () => {
    const fetchMock = mockCapabilityFetch(reader(), {
      extraRoutes: routes({
        '/admin/server-faults/by-request/01J8Z3K2QX0000000000000002': () => json({ item: { ...summary(2), stack: STACK } }),
      }),
    })
    await open()
    fireEvent.change(screen.getByLabelText(t.serverFaults.lookupLabel), { target: { value: '01J8Z3K2QX0000000000000002' } })
    fireEvent.click(screen.getByRole('button', { name: t.serverFaults.lookupButton }))
    const detail = await screen.findByRole('region', { name: t.serverFaults.detailTitle })
    expect(within(detail).getByText(/at loadEvent/)).toBeInTheDocument()
    expect(calls(fetchMock, '/admin/server-faults/by-request/')).toHaveLength(1)
  })

  it('logs an unknown id under ServerFaultsPage.open and shows no record', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapabilityFetch(reader(), {
      extraRoutes: routes({
        '/admin/server-faults/by-request/01J8Z3K2QXZZZZZZZZZZZZZZZZ': () => problem(PROBLEMS.NOT_FOUND),
      }),
    })
    await open()
    fireEvent.change(screen.getByLabelText(t.serverFaults.lookupLabel), { target: { value: '01J8Z3K2QXZZZZZZZZZZZZZZZZ' } })
    fireEvent.click(screen.getByRole('button', { name: t.serverFaults.lookupButton }))
    await waitFor(() => expect(error.mock.calls).toContainEqual(
      expect.arrayContaining(['ServerFaultsPage.open', expect.objectContaining({ type: PROBLEMS.NOT_FOUND.type })])))
    expect(screen.queryByRole('region', { name: t.serverFaults.detailTitle })).not.toBeInTheDocument()
  })

  it('searches a non-ULID id as the client\'s correlation id', async () => {
    const fetchMock = mockCapabilityFetch(reader(), { extraRoutes: routes() })
    await open()
    fireEvent.change(screen.getByLabelText(t.serverFaults.lookupLabel), { target: { value: 'support-ticket-42' } })
    fireEvent.click(screen.getByRole('button', { name: t.serverFaults.lookupButton }))
    await waitFor(() => expect(calls(fetchMock, '/admin/server-faults?').some((u) => u.includes('clientRequestId=support-ticket-42'))).toBe(true))
    expect(calls(fetchMock, '/admin/server-faults/by-request/')).toHaveLength(0)
  })

  it('shows the suppression banner only when faults were counted but not stored', async () => {
    mockCapabilityFetch(reader(), {
      extraRoutes: routes({ '/admin/server-faults': () => json({ items: [], nextCursor: null, suppressedLast24h: 15 }) }),
    })
    await open()
    expect(await screen.findByText(/15/)).toBeInTheDocument()

    // Unmount the first render, or it is still in the DOM below.
    cleanup()
    vi.unstubAllGlobals()
    // Counter-assertion: no banner at zero.
    mockCapabilityFetch(reader(), { extraRoutes: routes() })
    await open()
    await waitFor(() => expect(screen.getByText(summary(1).message)).toBeInTheDocument())
    expect(screen.queryByText(t.serverFaults.suppressedTitle)).not.toBeInTheDocument()
  })

  it('translates the labels but never the stored message', async () => {
    mockCapabilityFetch(reader(), { extraRoutes: routes() })
    await open('en')
    await waitFor(() => expect(screen.getByText(summary(2).message)).toBeInTheDocument())
    expect(screen.getByLabelText(en.serverFaults.lookupLabel)).toBeInTheDocument()
  })
})
