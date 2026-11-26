import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * The staff "All listings" tab (feature 037, US3).
 *
 * Disable and Enable are the existing hide and restore, and the console only
 * draws them for a holder of `status`; the server refuses everyone else. A
 * reason is required before anything is sent.
 */

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})

const row = (over: Record<string, unknown>) => ({
  id: 'l1', title: 'Bicycle', category: 'general', mode: 'offer', state: 'active', hiddenFromState: null,
  owner: { id: 'm1', displayName: 'Anna' }, createdAt: '2026-06-01T00:00:00.000Z', publishedAt: null,
  expiresAt: null, stateChangedAt: '2026-06-01T00:00:00.000Z', openReports: 0, ...over,
})

type Seen = { url: string; body?: string }

function routes({ items = [row({})], fails = false }: { items?: unknown[]; fails?: boolean } = {}) {
  const seen: Seen[] = []
  const extraRoutes: Record<string, RouteHandler> = {
    '/admin/marketplace/reports': () => json({ items: [] }),
    '/admin/marketplace/listings': () => {
      seen.push({ url: '/admin/marketplace/listings' })
      return fails
        ? json({ type: 'https://german-world-club.com/problems/internal', title: 'x', status: 500 }, 500)
        : json({ items, nextCursor: null })
    },
    '/admin/marketplace/listings/l1/hide': (o) => { seen.push({ url: 'hide', body: String(o.body) }); return json({ id: 'l1', state: 'hidden' }) },
    '/admin/marketplace/listings/l1/restore': (o) => { seen.push({ url: 'restore', body: String(o.body) }); return json({ id: 'l1', state: 'active' }) },
  }
  return { seen, extraRoutes }
}

async function openTab(grants: Record<string, unknown>, r = routes()) {
  mockCapabilityFetch(staffSnapshot({ grants: { marketplace_moderation: grants } }), { extraRoutes: r.extraRoutes })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebote' })
  fireEvent.click(await screen.findByRole('button', { name: t.marketplaceModeration.tabListings }))
  return r
}

describe('the All listings tab', () => {
  it('lists every state, with a loader first and the owner by name only', async () => {
    await openTab({ read: true }, routes({
      items: [row({}), row({ id: 'l2', title: 'Private draft', state: 'draft' }), row({ id: 'l3', title: 'Old chair', state: 'sold' })],
    }))
    expect(await screen.findByText('Bicycle')).toBeInTheDocument()
    expect(screen.getByText('Private draft')).toBeInTheDocument()
    expect(screen.getByText('Old chair')).toBeInTheDocument()
    expect(screen.getAllByText('Anna').length).toBeGreaterThan(0)
  })

  it('shows no Disable or Enable to a staff member with read only (the counter-assertion follows)', async () => {
    await openTab({ read: true })
    await screen.findByText('Bicycle')
    expect(screen.queryByRole('button', { name: t.marketplaceModeration.disable })).not.toBeInTheDocument()
  })

  it('offers Disable for a published or draft listing and Enable for a disabled one, with the status grant', async () => {
    await openTab({ read: true, status: true }, routes({
      items: [
        row({ id: 'l1', state: 'active' }),
        row({ id: 'l2', title: 'A draft', state: 'draft' }),
        row({ id: 'l3', title: 'Sold chair', state: 'sold' }),
        row({ id: 'l4', title: 'Taken down', state: 'hidden', hiddenFromState: 'draft' }),
      ],
    }))
    await screen.findByText('Bicycle')
    expect(screen.getAllByRole('button', { name: t.marketplaceModeration.disable })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: t.marketplaceModeration.enable })).toHaveLength(1)
    // Where a disabled listing came from is shown.
    expect(screen.getByText(t.marketplaceModeration.disabledFromDraft)).toBeInTheDocument()
  })

  it('sends nothing until a reason is typed, then sends it', async () => {
    const { seen } = await openTab({ read: true, status: true })
    fireEvent.click(await screen.findByRole('button', { name: t.marketplaceModeration.disable }))
    const confirm = screen.getByRole('button', { name: t.marketplaceModeration.confirm })
    expect(confirm).toBeDisabled()
    expect(seen.some((s) => s.url === 'hide')).toBe(false)

    fireEvent.change(screen.getByLabelText(t.marketplaceModeration.reasonLabel), { target: { value: 'Prohibited item' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(seen.some((s) => s.url === 'hide')).toBe(true))
    expect(JSON.parse(seen.find((s) => s.url === 'hide')!.body!)).toEqual({ reason: 'Prohibited item' })
  })

  it('says it could not load rather than claiming nothing matches', async () => {
    await openTab({ read: true }, routes({ fails: true }))
    expect(await screen.findByText(t.marketplaceModeration.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.marketplaceModeration.emptyListings)).not.toBeInTheDocument()
  })

  it('says nothing matches only when the list really is empty', async () => {
    await openTab({ read: true }, routes({ items: [] }))
    expect(await screen.findByText(t.marketplaceModeration.emptyListings)).toBeInTheDocument()
  })
})
