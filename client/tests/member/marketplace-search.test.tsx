import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 042, US4: searching the member marketplace on the web, and reaching
 * every page of results (FR-026, FR-027).
 *
 * The page used to show only the first page of listings and ignore the cursor the
 * server sent, so a search could never have been complete: results past the first
 * 20 were unreachable. "Load more" is part of this feature for that reason.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown): RouteHandler => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const listing = (n: number, title: string) => ({
  id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, title, body: `Beschreibung ${n}`, mode: 'offer',
  category: 'general', state: 'active', createdAt: '2026-09-23T10:00:00.000Z',
  owner: { id: '00000000-0000-4000-8000-0000000000ff', displayName: 'Judith Schmidt' },
  contact: { method: 'platform_message', available: true }, media: [],
})
const items = (...titles: string[]) => titles.map((title, i) => listing(i + 1, title))
const page = (titles: string[], nextCursor: string | null = null) => json({ items: items(...titles), nextCursor })

const open = (routes: Record<string, RouteHandler>) => {
  // The `?q=` and `?cursor=` keys first: the helper takes the first key matching the path or the path before its `?`.
  const { '/marketplace/listings': plain = page(['Sofa']), ...specific } = routes
  const fetchMock = mockCapabilityFetch(memberSnapshot(), {
    extraRoutes: {
      ...specific,
      '/marketplace/categories': json({ categories: [], vehicleFeatures: [] }),
      '/marketplace/terms': json({ version: 'v1', acceptedVersion: 'v1' }),
      '/marketplace/listings': plain,
    },
  })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
  return fetchMock
}
const listCalls = (fetchMock: ReturnType<typeof mockCapabilityFetch>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith('/marketplace/listings') && !u.includes('/media'))
const searchBox = () => screen.getByLabelText(t.memberMarketplace.search.label)
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('searching the marketplace on the web', () => {
  it('sends the search once, after the pause, with the filters already chosen', async () => {
    const fetchMock = open({ '/marketplace/listings?category=general&q=fahrrad': page(['Kinderfahrrad']) })
    await screen.findByText('Sofa')
    // The compose drawer has a category select too (it stays mounted); the browse filter is the last one.
    fireEvent.change(screen.getAllByLabelText(t.memberMarketplace.category).at(-1)!, { target: { value: 'general' } })
    await waitFor(() => expect(listCalls(fetchMock).some((u) => u.includes('category=general'))).toBe(true))

    for (const text of ['f', 'fa', 'fah', 'fahrrad']) type(text)
    expect(await screen.findByText('Kinderfahrrad')).toBeInTheDocument()
    await wait(400)
    const searches = listCalls(fetchMock).filter((u) => u.includes('q='))
    expect(searches).toEqual(['/marketplace/listings?category=general&q=fahrrad'])
  })

  it('sends nothing for one character', async () => {
    const fetchMock = open({})
    await screen.findByText('Sofa')
    type('f')
    await wait(600)
    expect(listCalls(fetchMock).filter((u) => u.includes('q='))).toEqual([])
  })

  it('ignores an older answer that arrives after a newer one', async () => {
    let releaseSlow!: () => void
    const gate = new Promise<void>((resolve) => { releaseSlow = resolve })
    open({
      '/marketplace/listings?q=fa': async () => { await gate; return { body: JSON.stringify({ items: items('Alt'), nextCursor: null }), headers: { 'content-type': 'application/json' } } },
      '/marketplace/listings?q=fahrrad': page(['Neu']),
    })
    await screen.findByText('Sofa')
    type('fa')
    await wait(450)
    type('fahrrad')
    expect(await screen.findByText('Neu')).toBeInTheDocument()
    releaseSlow()
    await wait(100)
    expect(screen.getByText('Neu')).toBeInTheDocument()
    expect(screen.queryByText('Alt')).toBeNull()
  })

  it('says nothing matched the search, which is not the same as there being no listings', async () => {
    open({ '/marketplace/listings?q=zzz': page([]) })
    await screen.findByText('Sofa')
    type('zzz')
    expect(await screen.findByText(t.memberMarketplace.search.noResults)).toBeInTheDocument()
    expect(screen.queryByText(t.memberMarketplace.empty)).toBeNull()
  })

  it('says there are no listings, not that a search matched nothing, when nobody searched', async () => {
    open({ '/marketplace/listings': page([]) })
    expect(await screen.findByText(t.memberMarketplace.empty)).toBeInTheDocument()
    expect(screen.queryByText(t.memberMarketplace.search.noResults)).toBeNull()
  })
})

describe('reaching every page of results', () => {
  it('shows "Load more" when the server has another page, and appends it with the same search', async () => {
    const fetchMock = open({
      '/marketplace/listings?q=rad&cursor=CURSOR1': page(['Rad dritte']),
      '/marketplace/listings?q=rad': page(['Rad erste', 'Rad zweite'], 'CURSOR1'),
    })
    await screen.findByText('Sofa')
    type('rad')
    await screen.findByText('Rad erste')

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.loadMore }))
    expect(await screen.findByText('Rad dritte')).toBeInTheDocument()
    // Appended, not replaced; and the search came along with the cursor.
    expect(screen.getByText('Rad erste')).toBeInTheDocument()
    expect(listCalls(fetchMock)).toContain('/marketplace/listings?q=rad&cursor=CURSOR1')
    // That was the last page: the button is gone.
    await waitFor(() => expect(screen.queryByRole('button', { name: t.memberMarketplace.loadMore })).toBeNull())
  })

  it('has no "Load more" when the first page is all there is', async () => {
    open({ '/marketplace/listings': page(['Sofa', 'Tisch'], null) })
    await screen.findByText('Tisch')
    expect(screen.queryByRole('button', { name: t.memberMarketplace.loadMore })).toBeNull()
  })

  it('works without any search too: the page used to ignore the cursor altogether', async () => {
    open({
      '/marketplace/listings?cursor=CURSOR9': page(['Zweite Seite']),
      '/marketplace/listings': page(['Erste Seite'], 'CURSOR9'),
    })
    await screen.findByText('Erste Seite')
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.loadMore }))
    expect(await screen.findByText('Zweite Seite')).toBeInTheDocument()
    expect(screen.getByText('Erste Seite')).toBeInTheDocument()
  })
})
