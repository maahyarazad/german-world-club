import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 042, US4: the search box on the merchant offers list (FR-026).
 *
 * The behaviours that are easy to get wrong are the timing ones: a request per
 * keystroke, an old answer landing after a new one, a "no results" message shown
 * for an empty catalogue (or the reverse), and an empty message while the
 * answer has not arrived. Real timers are used on purpose: the debounce is part of
 * what is under test, and fake timers fight `waitFor`.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown): RouteHandler => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const CATEGORY = '00000000-0000-4000-8000-00000000c001'
const card = (id: string, title: string) => ({
  id, title, benefit: { kind: 'percentage', value: 20 }, currency: 'EUR', validUntil: '2026-12-31T00:00:00.000Z',
  categoryId: CATEGORY, soldOut: false, thumbnail: null, merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
})
const page = (...titles: string[]) => json({ items: titles.map((title, i) => card(`00000000-0000-4000-8000-0000000000${i}${title.length}`, title)), nextCursor: null })
const category = { id: CATEGORY, slug: 'restaurants', nameDe: 'Küche', nameEn: 'Cuisine', offerCount: 3 }

const open = (routes: Record<string, RouteHandler>) => {
  // Most specific first: the helper takes the first key that matches the path (or the path before its `?`),
  // so the `?q=` keys go ahead of the plain list, which a test may replace.
  const { '/member/offers': plain = page('Alle Angebote'), ...specific } = routes
  const fetchMock = mockCapabilityFetch(memberSnapshot(), {
    extraRoutes: { ...specific, '/member/offers/categories': json({ items: [category] }), '/member/offers': plain },
  })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/angebote' })
  return fetchMock
}
const listCalls = (fetchMock: ReturnType<typeof mockCapabilityFetch>) =>
  fetchMock.mock.calls.map(([url]) => String(url)).filter((u) => u.startsWith('/member/offers') && !u.includes('/categories'))
const searchBox = () => screen.getByLabelText(t.clubOffers.search.label)
const type = (text: string) => fireEvent.change(searchBox(), { target: { value: text } })
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('searching merchant offers on the web', () => {
  it('sends one request after the person stops typing, not one per keystroke', async () => {
    const fetchMock = open({ '/member/offers?q=pizza': page('Pizza Margherita') })
    await screen.findByText('Alle Angebote')
    for (const text of ['p', 'pi', 'piz', 'pizz', 'pizza']) type(text)
    expect(await screen.findByText('Pizza Margherita')).toBeInTheDocument()
    await wait(400)
    const searches = listCalls(fetchMock).filter((u) => u.includes('q='))
    // Counter-assertion: not 'q=pi', 'q=piz', 'q=pizz' as well.
    expect(searches).toEqual(['/member/offers?q=pizza'])
  })

  it('sends nothing for a single character: it would match nearly everything', async () => {
    const fetchMock = open({})
    await screen.findByText('Alle Angebote')
    type('p')
    await wait(600)
    expect(listCalls(fetchMock).filter((u) => u.includes('q='))).toEqual([])
    expect(screen.getByText('Alle Angebote')).toBeInTheDocument()
  })

  it('goes back to the whole list when the box is cleared', async () => {
    const fetchMock = open({ '/member/offers?q=pizza': page('Pizza Margherita') })
    await screen.findByText('Alle Angebote')
    type('pizza')
    await screen.findByText('Pizza Margherita')

    fireEvent.click(screen.getByRole('button', { name: t.clubOffers.search.clear }))
    expect(await screen.findByText('Alle Angebote')).toBeInTheDocument()
    expect(screen.queryByText('Pizza Margherita')).toBeNull()
    expect(listCalls(fetchMock).at(-1)).toBe('/member/offers')
  })

  it('ignores an older answer that arrives after a newer one', async () => {
    let releaseSlow!: () => void
    const gate = new Promise<void>((resolve) => { releaseSlow = resolve })
    open({
      '/member/offers?q=pi': async () => { await gate; return { body: JSON.stringify({ items: [card('00000000-0000-4000-8000-0000000000e1', 'Alt'), ], nextCursor: null }), headers: { 'content-type': 'application/json' } } },
      '/member/offers?q=pizza': page('Neu'),
    })
    await screen.findByText('Alle Angebote')
    type('pi')
    await wait(450) // the first search is now in flight and pending
    type('pizza')
    expect(await screen.findByText('Neu')).toBeInTheDocument()

    releaseSlow() // the stale answer lands now
    await wait(100)
    expect(screen.getByText('Neu')).toBeInTheDocument()
    expect(screen.queryByText('Alt')).toBeNull()
  })

  it('says nothing matched the search, which is not the same as an empty catalogue', async () => {
    open({ '/member/offers?q=zzz': page() })
    await screen.findByText('Alle Angebote')
    type('zzz')
    expect(await screen.findByText(t.clubOffers.search.noResults)).toBeInTheDocument()
    expect(screen.queryByText(t.clubOffers.empty)).toBeNull()
  })

  it('says the catalogue is empty, not that a search matched nothing, when there is no search', async () => {
    open({ '/member/offers': page() })
    expect(await screen.findByText(t.clubOffers.empty)).toBeInTheDocument()
    expect(screen.queryByText(t.clubOffers.search.noResults)).toBeNull()
  })

  it('shows neither message while the answer has not arrived (never a false "empty")', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    open({
      '/member/offers?q=pizza': async () => { await gate; return { body: JSON.stringify({ items: [], nextCursor: null }), headers: { 'content-type': 'application/json' } } },
    })
    await screen.findByText('Alle Angebote')
    type('pizza')
    await wait(500)
    expect(screen.queryByText(t.clubOffers.search.noResults)).toBeNull()
    expect(screen.queryByText(t.clubOffers.empty)).toBeNull()
    release()
    expect(await screen.findByText(t.clubOffers.search.noResults)).toBeInTheDocument()
  })

  it('keeps the search when a category is chosen, and sends both', async () => {
    const fetchMock = open({ '/member/offers?q=pizza': page('Pizza Margherita') })
    await screen.findByText('Alle Angebote')
    type('pizza')
    await screen.findByText('Pizza Margherita')

    fireEvent.click(await screen.findByRole('button', { name: 'Küche (3)' }))
    await waitFor(() => expect(listCalls(fetchMock).some((u) => u.includes(`categoryId=${CATEGORY}`) && u.includes('q=pizza'))).toBe(true))
    expect((searchBox() as HTMLInputElement).value).toBe('pizza')
  })
})
