import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import type { MediaItem } from '@gwc/contracts/media'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 042, US2: the picture of an offer on the list card and on the detail
 * page, in a 16:9 frame, or the club's fallback when the server says there is no
 * usable media (FR-001, FR-007, FR-008).
 *
 * The positive and the negative are asserted together everywhere: a card that
 * always drew the fallback, or one that never did, would each pass half of this.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})

const ID = '00000000-0000-4000-8000-0000000000a1'
const CATEGORY = '00000000-0000-4000-8000-00000000c001'
const photo = (n: number): MediaItem => ({
  assetId: `00000000-0000-4000-8000-0000000000${n}0`, kind: 'image', alt: `Foto ${n}`, width: 1600, height: 900, durationMs: null,
  variants: [{ variant: 'small', format: 'webp', width: 480, height: 270, url: `/media/p${n}/small.webp` }],
  posterUrl: null,
})
const card = (thumbnail: MediaItem | null) => ({
  id: ID, title: 'Zwei Kaffee', benefit: { kind: 'percentage', value: 20 }, currency: 'EUR',
  validUntil: '2026-12-31T00:00:00.000Z', categoryId: CATEGORY, soldOut: false, thumbnail,
  merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
})
const offer = (media: MediaItem[]) => ({
  id: ID, title: 'Zwei Kaffee', description: 'Zwei zum Preis von einem', benefit: { kind: 'percentage', value: 20 },
  regularPriceCents: 1000, memberPriceCents: 800, currency: 'EUR', validFrom: '2026-11-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z', conditions: null, perPersonLimit: null,
  category: { id: CATEGORY, slug: 'restaurants', nameDe: 'Küche', nameEn: 'Cuisine' },
  media, merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
})

const open = (routes: Record<string, RouteHandler>, route: string) => {
  mockCapabilityFetch(memberSnapshot(), {
    extraRoutes: { '/member/offers/categories': json({ items: [] }), ...routes },
  })
  return renderConsole(<ConsoleRoutes />, { route })
}

describe('the offers list card', () => {
  it('draws the club fallback in a 16:9 frame when the offer has no thumbnail', async () => {
    const { container } = open({ '/member/offers': json({ items: [card(null)], nextCursor: null }) }, '/konsole/mitglied/angebote')
    await screen.findByText('Zwei Kaffee')
    const imgs = [...container.querySelectorAll('li img')]
    expect(imgs).toHaveLength(1)
    expect(imgs[0]!.getAttribute('src')).toContain('offer-fallback')
    expect(imgs[0]!.getAttribute('alt')).toBe(t.clubOffers.fallbackAlt)
    expect(container.querySelector('li [data-aspect="16/9"]')).not.toBeNull()
    // The old card was 4:3.
    expect(container.querySelector('li [class*="aspect-[4/3]"]')).toBeNull()
  })

  it('draws the offer\'s own thumbnail, and not the fallback, when it has one', async () => {
    const { container } = open({ '/member/offers': json({ items: [card(photo(1))], nextCursor: null }) }, '/konsole/mitglied/angebote')
    await screen.findByText('Zwei Kaffee')
    const img = container.querySelector('li img')!
    expect(img.getAttribute('src')).toBe('/media/p1/small.webp')
    expect(img.getAttribute('alt')).toBe('Foto 1')
    expect(container.querySelector('li img[src*="offer-fallback"]')).toBeNull()
  })

  it('falls back when the thumbnail fails to load', async () => {
    const { container } = open({ '/member/offers': json({ items: [card(photo(1))], nextCursor: null }) }, '/konsole/mitglied/angebote')
    await screen.findByText('Zwei Kaffee')
    fireEvent.error(container.querySelector('li img')!)
    expect(container.querySelector('li img')!.getAttribute('src')).toContain('offer-fallback')
  })
})

describe('the offer detail page', () => {
  it('shows the fallback and no carousel when the offer has no media', async () => {
    const { container } = open({ [`/member/offers/${ID}`]: json(offer([])) }, `/konsole/mitglied/angebote/${ID}`)
    await screen.findByText('Zwei zum Preis von einem')
    expect(container.querySelector('img[src*="offer-fallback"]')).not.toBeNull()
    expect(screen.queryByRole('region', { name: t.clubOffers.gallery.region })).toBeNull()
  })

  it('shows a paged gallery, not the fallback, when the offer has media', async () => {
    const { container } = open({ [`/member/offers/${ID}`]: json(offer([photo(1), photo(2)])) }, `/konsole/mitglied/angebote/${ID}`)
    await screen.findByText('Zwei zum Preis von einem')
    expect(screen.getByRole('region', { name: t.clubOffers.gallery.region })).toBeInTheDocument()
    expect(container.querySelectorAll('[role="group"][aria-roledescription="slide"]')).toHaveLength(2)
    expect(container.querySelector('img[src*="offer-fallback"]')).toBeNull()
  })
})
