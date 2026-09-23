import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'

/**
 * The staff moderation screen (008 US4, T088).
 *
 * The capability pair every console screen needs: it renders for a holder of
 * `marketplace_moderation`, and it does NOT for a non-holder — the same
 * `RequireGrant` discipline as everywhere else in the console, and the same
 * reason `unbuilt-areas.test.tsx` exists for the areas that have no screen at
 * all yet. This is the first that does.
 */

afterEach(() => vi.unstubAllGlobals())

const REPORTS_ROUTE = '/admin/marketplace/reports'

const emptyQueue = () => ({
  body: JSON.stringify({ items: [] }),
  headers: { 'content-type': 'application/json' },
})

describe('the marketplace moderation screen', () => {
  it('renders for a holder of marketplace_moderation', async () => {
    mockCapabilityFetch(
      staffSnapshot({ grants: { marketplace_moderation: { read: true } } }),
      { extraRoutes: { [REPORTS_ROUTE]: emptyQueue } },
    )
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })

    await waitFor(() => {
      expect(screen.getByText(t.marketplaceModeration.title)).toBeInTheDocument()
    })
    // The counter-assertion: it did not fall through to "not available".
    expect(screen.queryByText(t.console.notAvailable)).not.toBeInTheDocument()
  })

  it('does NOT render for a staff member without the grant', async () => {
    mockCapabilityFetch(
      // Some other module, so this is a real staff session that simply lacks
      // marketplace_moderation — not an empty or broken one.
      staffSnapshot({ grants: { members: true } }),
      { extraRoutes: { [REPORTS_ROUTE]: emptyQueue } },
    )
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })

    await waitFor(() => {
      expect(screen.getByText(t.console.notAvailable)).toBeInTheDocument()
    })
    expect(screen.queryByText(t.marketplaceModeration.title)).not.toBeInTheDocument()
  })

  it('shows the report queue for a holder', async () => {
    mockCapabilityFetch(
      staffSnapshot({ grants: { marketplace_moderation: { read: true } } }),
      {
        extraRoutes: {
          [REPORTS_ROUTE]: () => ({
            body: JSON.stringify({
              items: [{
                id: 'r1', listingId: 'l1', reporterId: 'm1',
                reason: 'Looks like a scam', state: 'open', createdAt: '2026-06-01T00:00:00.000Z',
                listingTitle: 'A suspicious bicycle', listingState: 'active',
              }],
            }),
            headers: { 'content-type': 'application/json' },
          }),
        },
      },
    )
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })

    await waitFor(() => {
      expect(screen.getByText('A suspicious bicycle')).toBeInTheDocument()
      expect(screen.getByText('Looks like a scam')).toBeInTheDocument()
    })
  })

  it('offers no status controls to a member holding only `read`', async () => {
    mockCapabilityFetch(
      staffSnapshot({ grants: { marketplace_moderation: { read: true } } }),
      {
        extraRoutes: {
          [REPORTS_ROUTE]: () => ({
            body: JSON.stringify({
              items: [{
                id: 'r1', listingId: 'l1', reporterId: 'm1',
                reason: 'x', state: 'open', createdAt: '2026-06-01T00:00:00.000Z',
                listingTitle: 'A listing', listingState: 'active',
              }],
            }),
            headers: { 'content-type': 'application/json' },
          }),
        },
      },
    )
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })

    await waitFor(() => {
      expect(screen.getByText('A listing')).toBeInTheDocument()
    })
    // Absent, not disabled — RequireGrant.tsx's rule applied to a control
    // rather than a whole screen. `read` alone must render a queue with
    // nothing in it a reader could click to change anything.
    expect(screen.queryByText(t.marketplaceModeration.hide)).not.toBeInTheDocument()
    expect(screen.queryByText(t.marketplaceModeration.remove)).not.toBeInTheDocument()
  })

  it('offers the hide control to a holder of `status`', async () => {
    mockCapabilityFetch(
      staffSnapshot({ grants: { marketplace_moderation: { read: true, status: true } } }),
      {
        extraRoutes: {
          [REPORTS_ROUTE]: () => ({
            body: JSON.stringify({
              items: [{
                id: 'r1', listingId: 'l1', reporterId: 'm1',
                reason: 'x', state: 'open', createdAt: '2026-06-01T00:00:00.000Z',
                listingTitle: 'A listing', listingState: 'active',
              }],
            }),
            headers: { 'content-type': 'application/json' },
          }),
        },
      },
    )
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })

    await waitFor(() => {
      expect(screen.getByText(t.marketplaceModeration.hide)).toBeInTheDocument()
    })
    // And still no `remove` — that needs `delete`, a different flag.
    expect(screen.queryByText(t.marketplaceModeration.remove)).not.toBeInTheDocument()
  })
})
