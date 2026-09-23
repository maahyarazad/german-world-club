import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'

/**
 * The member marketplace tab (008 US6, T093).
 *
 * The compose control is a per-member PERMISSION (`marketplace_post`), not a
 * staff module — but the rule is the same one `RequireGrant.tsx` states for
 * staff screens: absent, not disabled, without the flag. A member who can
 * browse but not sell must see a browse page with no compose form at all, not
 * a greyed-out one that invites finding out what a re-enabled button does.
 */

afterEach(() => vi.unstubAllGlobals())

const CATEGORIES_ROUTE = '/marketplace/categories'
const LISTINGS_ROUTE = '/marketplace/listings'
const TERMS_ROUTE = '/marketplace/terms'

const emptyCategories = () => ({
  body: JSON.stringify({ categories: [], vehicleFeatures: [] }),
  headers: { 'content-type': 'application/json' },
})

const emptyListings = () => ({
  body: JSON.stringify({ items: [], nextCursor: null }),
  headers: { 'content-type': 'application/json' },
})

const terms = () => ({
  body: JSON.stringify({ version: 'v1', acceptedVersion: null }),
  headers: { 'content-type': 'application/json' },
})

const routes = {
  [CATEGORIES_ROUTE]: emptyCategories,
  [LISTINGS_ROUTE]: emptyListings,
  [TERMS_ROUTE]: terms,
}

describe('the member marketplace tab', () => {
  it('renders the browse page for any member', async () => {
    mockCapabilityFetch({ ...memberSnapshot(), permissions: [] }, { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    // The page title and the sidebar tab label are both "Marktplatz" in
    // German, so the heading is matched by role rather than by text alone.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t.memberMarketplace.title })).toBeInTheDocument()
    })
  })

  it('has NO compose control without marketplace_post', async () => {
    mockCapabilityFetch({ ...memberSnapshot(), permissions: [] }, { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await waitFor(() => {
      expect(screen.getByText(t.memberMarketplace.browseTitle)).toBeInTheDocument()
    })
    expect(screen.queryByText(t.memberMarketplace.composeTitle)).not.toBeInTheDocument()
  })

  it('HAS the compose control with marketplace_post — the counter-assertion', async () => {
    mockCapabilityFetch({ ...memberSnapshot(), permissions: ['marketplace_post'] }, { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await waitFor(() => {
      expect(screen.getByText(t.memberMarketplace.composeTitle)).toBeInTheDocument()
    })
  })

  it('keeps the sidebar, so the session reads as intact', async () => {
    mockCapabilityFetch({ ...memberSnapshot(), permissions: [] }, { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: t.portals.member })).toBeInTheDocument()
    })
  })
})
