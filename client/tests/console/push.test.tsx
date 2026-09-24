import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * The console's Push section (feature 011, US3, T068).
 *
 * The rules that matter here are about sending exactly what staff meant,
 * exactly once: nothing goes out before the audience confirm, a double click is
 * one request, and the `clientRef` changes between two messages but not
 * between a message and its retry (research R2, analysis U1).
 */

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})
const problem = (p: { type: string; status: number; title: string }) => ({
  body: JSON.stringify({ type: p.type, title: p.title, status: p.status }),
  status: p.status,
  headers: { 'content-type': 'application/problem+json' },
})

const NOTIFICATION = {
  id: '11111111-1111-4111-8111-111111111111', kind: 'broadcast', status: 'queued',
  createdAt: '2026-09-24T10:00:00.000Z', sentAt: null, finishedAt: null,
  de: { title: 'T', body: 'B' }, en: { title: 'T', body: 'B' }, destination: null, sentBy: null,
  totals: { pending: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 },
}

function routes(overrides: Record<string, RouteHandler> = {}) {
  return {
    '/push/test-recipients': () => json({ recipients: [] }),
    '/push/campaigns': () => json({ notifications: [] }),
    '/push/audience': () => json({ members: 1234, devices: 1500 }),
    ...overrides,
  }
}

const holder = () => staffSnapshot({ grants: { mass_messages: true } })

async function openCompose() {
  renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/push' })
  await waitFor(() => expect(screen.getByText(t.pushAdmin.pageTitle)).toBeInTheDocument())
}

function fill(suffix = '') {
  const titles = screen.getAllByLabelText(t.pushAdmin.title)
  const bodies = screen.getAllByLabelText(t.pushAdmin.body)
  fireEvent.change(titles[0]!, { target: { value: `Titel${suffix}` } })
  fireEvent.change(bodies[0]!, { target: { value: `Nachricht${suffix}` } })
  fireEvent.change(titles[1]!, { target: { value: `Title${suffix}` } })
  fireEvent.change(bodies[1]!, { target: { value: `Message${suffix}` } })
}

const sends = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) =>
  fetchMock.mock.calls.filter(([url, options]) => String(url) === path && (options as RequestInit)?.method === 'POST')

const refOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)).clientRef as string

describe('the push console', () => {
  it('renders for a holder of mass_messages, and not for anyone else', async () => {
    mockCapabilityFetch(holder(), { extraRoutes: routes() })
    await openCompose()
    expect(screen.queryByText(t.console.notAvailable)).not.toBeInTheDocument()

    vi.unstubAllGlobals()
    mockCapabilityFetch(staffSnapshot({ grants: { members: true } }), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/push' })
    await waitFor(() => expect(screen.getAllByText(t.console.notAvailable).length).toBeGreaterThan(0))
  })

  it('shows who a broadcast reaches before sending anything', async () => {
    const fetchMock = mockCapabilityFetch(holder(), {
      extraRoutes: routes({ '/push/campaigns': (o) => (o.method === 'POST' ? json(NOTIFICATION, 202) : json({ notifications: [] })) }),
    })
    await openCompose()
    fill()

    fireEvent.click(screen.getByRole('button', { name: t.pushAdmin.broadcast }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog').textContent).toContain('1.234')
    expect(screen.getByRole('alertdialog').textContent).toContain('1.500')
    expect(sends(fetchMock, '/push/campaigns')).toHaveLength(0)

    // Counter-assertion: confirming does send.
    fireEvent.click(screen.getByRole('button', { name: t.pushAdmin.confirmSend }))
    await waitFor(() => expect(sends(fetchMock, '/push/campaigns')).toHaveLength(1))
  })

  it('sends one request for a double click', async () => {
    let release: () => void = () => {}
    const fetchMock = mockCapabilityFetch(holder(), {
      extraRoutes: routes({
        '/push/campaigns/preview': () => new Promise((resolve) => { release = () => resolve(json(NOTIFICATION, 202)) }),
      }),
    })
    await openCompose()
    fill()

    const button = screen.getByRole('button', { name: t.pushAdmin.sendRehearsal })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(sends(fetchMock, '/push/campaigns/preview')).toHaveLength(1))
    release()
    await waitFor(() => expect(screen.getByText(t.pushAdmin.rehearsalQueued)).toBeInTheDocument())
    expect(sends(fetchMock, '/push/campaigns/preview')).toHaveLength(1)
  })

  it('translates the empty-test-list refusal', async () => {
    mockCapabilityFetch(holder(), {
      extraRoutes: routes({ '/push/campaigns/preview': () => problem(PROBLEMS.PUSH_NO_TEST_RECIPIENTS) }),
    })
    await openCompose()
    fill()

    fireEvent.click(screen.getByRole('button', { name: t.pushAdmin.sendRehearsal }))

    await waitFor(() => expect(screen.getByText(/Keine Testnutzer/)).toBeInTheDocument())
  })

  it('uses a new clientRef for the next message, and the same one for a retry', async () => {
    let failNext = false
    const fetchMock = mockCapabilityFetch(holder(), {
      extraRoutes: routes({
        '/push/campaigns/preview': () => {
          if (failNext) { failNext = false; throw new TypeError('Failed to fetch') }
          return json(NOTIFICATION, 202)
        },
      }),
    })
    await openCompose()
    const button = () => screen.getByRole('button', { name: t.pushAdmin.sendRehearsal })

    fill(' eins')
    fireEvent.click(button())
    await waitFor(() => expect(sends(fetchMock, '/push/campaigns/preview')).toHaveLength(1))
    await waitFor(() => expect(button()).not.toBeDisabled())

    fill(' zwei')
    failNext = true
    fireEvent.click(button())
    await waitFor(() => expect(screen.getByText(t.pushAdmin.networkError)).toBeInTheDocument())
    fireEvent.click(button())
    await waitFor(() => expect(sends(fetchMock, '/push/campaigns/preview')).toHaveLength(3))

    const [first, second, retry] = sends(fetchMock, '/push/campaigns/preview').map(refOf)
    expect(second).not.toBe(first)
    expect(retry).toBe(second)
  })
})
