import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'

/**
 * Feature 042, US3: a merchant sees which of an offer's files is the main one and
 * can choose another (FR-013). The list of tiles shows the leading one marked, and
 * "Make main" sits on every other tile.
 *
 * The server moves the file; this page only sends the request and shows the order
 * the server answered with.
 */
afterEach(() => vi.unstubAllGlobals())

const merchantSnapshot = () => ({
  kind: 'merchant', id: '00000000-0000-4000-8000-000000000001', displayName: 'Meryem Menne',
  organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Café Test',
  organisationStatus: 'active', role: 'owner', available: [],
})

const OFFER = '00000000-0000-4000-8000-0000000000a1'
const CATEGORY = '00000000-0000-4000-8000-00000000c001'
const file = (n: number) => ({
  assetId: `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`,
  kind: 'image', alt: `Bild ${n}`, width: 1600, height: 900, durationMs: null, posterUrl: null,
  variants: [{ variant: 'thumb', format: 'webp', width: 160, height: 90, url: `/media/f${n}/thumb.webp` }],
})
const offerWith = (n: number) => ({
  id: OFFER, state: 'published', title: 'Zwei Kaffee', description: null, categoryId: CATEGORY,
  benefit: { kind: 'percentage', value: 20 }, regularPriceCents: null, memberPriceCents: null, currency: 'EUR',
  validFrom: '2026-11-01T00:00:00.000Z', validUntil: '2026-12-31T00:00:00.000Z', conditions: null,
  remaining: null, perPersonLimit: 1, sortPosition: 0, publishedAt: '2026-11-01T00:00:00.000Z',
  media: Array.from({ length: n }, (_, i) => file(i + 1)), version: '2026-11-23T10:00:00.000000Z',
})

type Handler = () => { status?: number; body?: string; headers?: Record<string, string> } | Promise<{ status?: number; body?: string; headers?: Record<string, string> }>
const ok = (body: unknown): Handler => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const open = (media: number, mainMedia: Handler) => {
  const fetchMock = mockCapabilityFetch(merchantSnapshot(), {
    extraRoutes: {
      '/merchant/categories': ok({ items: [] }),
      '/merchant/offers': ok({ items: [offerWith(media)] }),
      [`/merchant/offers/${OFFER}/main-media`]: mainMedia,
    },
  })
  const view = renderConsole(<ConsoleRoutes />, { route: `/konsole/merchant/angebote/${OFFER}` })
  return { fetchMock, ...view }
}

// The media tiles only: list items holding one of the offer's pictures (the sidebar is a list too).
const tiles = (container: HTMLElement) =>
  [...container.querySelectorAll('li')].filter((li) => li.querySelector('img[alt^="Bild"]')) as HTMLElement[]
const makeMain = () => t.merchantOffers.makeMain

describe('the merchant editor’s media tiles', () => {
  it('marks the leading file as main and offers "Make main" on every other one', async () => {
    const { container } = open(3, ok({ media: [] }))
    await screen.findByAltText('Bild 1')
    const [first, second, third] = tiles(container) as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText(t.merchantOffers.mainBadge)).toBeInTheDocument()
    expect(within(first).queryByRole('button', { name: makeMain() })).toBeNull()
    expect(within(second).getByRole('button', { name: makeMain() })).toBeInTheDocument()
    expect(within(third).getByRole('button', { name: makeMain() })).toBeInTheDocument()
    expect(screen.getAllByText(t.merchantOffers.mainBadge)).toHaveLength(1)
  })

  it('sends the chosen file and then shows the order the server answered with', async () => {
    const answer = { media: [file(3), file(1), file(2)] }
    const { container, fetchMock } = open(3, ok(answer))
    await screen.findByAltText('Bild 3')
    fireEvent.click(within(tiles(container)[2]!).getByRole('button', { name: makeMain() }))

    await waitFor(() => expect(within(tiles(container)[0]!).getByAltText('Bild 3')).toBeInTheDocument())
    const call = fetchMock.mock.calls.find(([url]) => String(url) === `/merchant/offers/${OFFER}/main-media`)!
    expect((call[1] as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ assetId: file(3).assetId })

    const [first, second, third] = tiles(container) as [HTMLElement, HTMLElement, HTMLElement]
    expect(within(first).getByText(t.merchantOffers.mainBadge)).toBeInTheDocument()
    expect(within(second).getByAltText('Bild 1')).toBeInTheDocument()
    expect(within(second).getByRole('button', { name: makeMain() })).toBeInTheDocument()
    expect(within(third).getByAltText('Bild 2')).toBeInTheDocument()
    expect(screen.getAllByText(t.merchantOffers.mainBadge)).toHaveLength(1)
  })

  it('disables the buttons while the request is running, so one press is one request', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { container, fetchMock } = open(2, async () => {
      await gate
      return { body: JSON.stringify({ media: [file(2), file(1)] }), headers: { 'content-type': 'application/json' } }
    })
    await screen.findByAltText('Bild 2')
    const button = within(tiles(container)[1]!).getByRole('button', { name: makeMain() })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)
    release()
    await waitFor(() => expect(within(tiles(container)[0]!).getByAltText('Bild 2')).toBeInTheDocument())
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/main-media'))).toHaveLength(1)
  })

  it('leaves the tiles as they were, and logs, when the server refuses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = open(2, () => ({
      status: 422,
      body: JSON.stringify({ type: 'https://german-world-club.com/problems/offers/media-not-attached', title: 'x', status: 422 }),
      headers: { 'content-type': 'application/problem+json' },
    }))
    await screen.findByAltText('Bild 2')
    fireEvent.click(within(tiles(container)[1]!).getByRole('button', { name: makeMain() }))
    await waitFor(() => expect(log.mock.calls.some(([label]) => label === 'OfferEditor.makeMain')).toBe(true))
    // Counter-assertion: the failed choice did not move anything.
    expect(within(tiles(container)[0]!).getByAltText('Bild 1')).toBeInTheDocument()
    log.mockRestore()
  })

  it('shows the badge but no "Make main" button when there is only one file', async () => {
    const { container } = open(1, ok({ media: [] }))
    await screen.findByAltText('Bild 1')
    expect(within(tiles(container)[0]!).getByText(t.merchantOffers.mainBadge)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: makeMain() })).toBeNull()
  })

  it('says there is no media yet, rather than showing the fallback as a file, when there is none', async () => {
    const { container } = open(0, ok({ media: [] }))
    expect(await screen.findByText(t.merchantOffers.mediaNone)).toBeInTheDocument()
    expect(tiles(container)).toHaveLength(0)
    expect(container.querySelector('img[src*="offer-fallback"]')).toBeNull()
  })
})
