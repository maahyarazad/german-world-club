import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { DASHBOARD_FIGURES } from '@gwc/contracts/admin'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'

/**
 * The Admin Panel dashboard (feature 028, US1): a superadmin sees the club in
 * numbers instead of the granted-areas tiles; everyone else sees what they did
 * before and never asks for the figures. Each case has its counter-assertion.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const figures = (overrides: Record<string, number | null> = {}) => ({
  asOf: '2026-11-17T10:00:00.000Z',
  figures: DASHBOARD_FIGURES.map((key, i) => ({ key, value: key in overrides ? overrides[key]! : 1200 + i })),
})

const calls = (fetchMock: ReturnType<typeof mockCapabilityFetch>) => fetchMock.mock.calls.map(([url]) => String(url))

describe('the superadmin dashboard', () => {
  it('shows the nine figures with German grouping, and none of the granted-areas content', async () => {
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { members: true, admins: true } }), {
      extraRoutes: { '/admin/dashboard/figures': json(figures()) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })

    expect(await screen.findByText('1.200')).toBeInTheDocument()
    for (const key of DASHBOARD_FIGURES) {
      expect(screen.getByText(t.adminDashboard.figures[key]), key).toBeInTheDocument()
    }
    // The old tiles and the list of areas are gone (counter-assertion for the staff case below).
    expect(screen.queryByText(t.adminDashboard.grantedAreas)).not.toBeInTheDocument()
    expect(screen.queryByText(t.adminDashboard.yourAreas)).not.toBeInTheDocument()
  })

  it('shows "unavailable" for a figure that could not be computed, never zero', async () => {
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { admins: true } }), {
      extraRoutes: { '/admin/dashboard/figures': json(figures({ openReports: null })) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })

    await screen.findByText(t.adminDashboard.figures.openReports)
    expect(screen.getByText(t.adminDashboard.figureUnavailable)).toBeInTheDocument()
    // The other eight are real numbers, and no tile pretends to be 0.
    expect(screen.getAllByText(/^1\.\d{3}$/)).toHaveLength(8)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('shows a failed-to-load notice and logs the refusal rather than showing it', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { admins: true } }), {
      extraRoutes: {
        '/admin/dashboard/figures': json({ type: 'https://german-world-club.com/problems/internal', title: 'Internal', status: 500, detail: 'secret detail' }, 500),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })

    expect(await screen.findByText(t.adminDashboard.figuresFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.adminDashboard.figures.activeMembers)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret detail')
    await waitFor(() => expect(errors.mock.calls.some((c) => String(c[0]).startsWith('AdminDashboard.figures'))).toBe(true))
  })
})

describe('the dashboard of any other staff member', () => {
  it('is what it was, and never asks for the club figures', async () => {
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { members: true, admins: { read: true } } }), {
      extraRoutes: { '/admin/dashboard/figures': json(figures()) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })

    expect(await screen.findByText(t.adminDashboard.yourAreas)).toBeInTheDocument()
    expect(screen.getByText(t.adminDashboard.grantedAreas)).toBeInTheDocument()
    expect(screen.queryByText(t.adminDashboard.figures.activeMembers)).not.toBeInTheDocument()
    expect(calls(fetchMock)).not.toContain('/admin/dashboard/figures')
  })
})
