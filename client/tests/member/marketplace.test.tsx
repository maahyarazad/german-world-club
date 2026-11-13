import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot, staffSnapshot } from '../helpers/console'
import { Marketplace } from '../../src/member/Marketplace'

/**
 * The member marketplace tab (008 US6, T093).
 *
 * Since feature 021 every member may post: the compose control no longer
 * depends on a per-member flag (`marketplace_post` was retired). It is still
 * absent, not disabled, for anyone who is not a member — the server refuses
 * them regardless (Principle I: the client only decides what to display).
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

// Built through a helper rather than as an inline literal: mockCapabilityFetch
// types its snapshot loosely, and an inline `permissions` key is an excess
// property to tsc.
const member = (permissions: string[]) => ({ ...memberSnapshot(), permissions })

const routes = {
  [CATEGORIES_ROUTE]: emptyCategories,
  [LISTINGS_ROUTE]: emptyListings,
  [TERMS_ROUTE]: terms,
}

describe('the member marketplace tab', () => {
  it('renders the browse page for any member', async () => {
    mockCapabilityFetch(member([]), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    // The page title and the sidebar tab label are both "Marktplatz" in
    // German, so the heading is matched by role rather than by text alone.
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: t.memberMarketplace.title })).toBeInTheDocument()
    })
  })

  it('HAS the New listing button for a member with NO permissions, top right, and no form until asked', async () => {
    mockCapabilityFetch(member([]), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    const button = await screen.findByRole('button', { name: t.memberMarketplace.newListing })
    // In the page header's action slot, which is the top-right corner.
    expect(button.closest('header')).not.toBeNull()
    expect(button).toHaveAttribute('aria-expanded', 'false')
    // The drawer is mounted (so a draft survives a close) but not open.
    expect(document.querySelector('dialog')).not.toBeNull()
    expect(document.querySelector('dialog')!.hasAttribute('open')).toBe(false)
  })

  it('has NO compose control for a principal who is not a member — the counter-assertion', async () => {
    // Without this, the test above would pass against a page that showed the
    // button to everybody, staff included.
    mockCapabilityFetch(staffSnapshot(), { extraRoutes: routes })
    renderConsole(<Marketplace />, { route: '/konsole/mitglied' })

    await waitFor(() => {
      expect(screen.getByText(t.memberMarketplace.browseTitle)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: t.memberMarketplace.newListing })).not.toBeInTheDocument()
    expect(document.querySelector('dialog')).toBeNull()
  })

  it('opens the compose panel from the header button', async () => {
    mockCapabilityFetch(member([]), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    const button = await screen.findByRole('button', { name: t.memberMarketplace.newListing })
    fireEvent.click(button)

    const dialog = document.querySelector('dialog')!
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByRole('heading', { name: t.memberMarketplace.composeTitle })).toBeInTheDocument()
  })

  it('keeps the sidebar, so the session reads as intact', async () => {
    mockCapabilityFetch(member([]), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    await waitFor(() => {
      expect(screen.getByRole('navigation', { name: t.portals.member })).toBeInTheDocument()
    })
  })
})
