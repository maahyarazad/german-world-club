import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 042, US3: a super admin chooses an offer's main media from the offer's
 * page in the staff console (FR-014).
 *
 * Whether to SHOW the control follows the capability snapshot and is display
 * only (Principle I): the server refuses anyone else. The counter-assertions are
 * the point: staff who hold `merchant_offers` but are not a super admin, and a
 * member, must not be offered it.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown): RouteHandler => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const ID = '00000000-0000-4000-8000-0000000000a1'
const CATEGORY = '00000000-0000-4000-8000-00000000c001'
const file = (n: number) => ({
  assetId: `00000000-0000-4000-8000-0000000003${String(n).padStart(2, '0')}`,
  kind: 'image', alt: `Bild ${n}`, width: 1600, height: 900, durationMs: null, posterUrl: null,
  variants: [{ variant: 'medium', format: 'webp', width: 960, height: 540, url: `/media/f${n}/medium.webp` }],
})
const offer = {
  id: ID, title: 'Zwei Kaffee', description: 'Zwei zum Preis von einem', benefit: { kind: 'percentage', value: 20 },
  regularPriceCents: null, memberPriceCents: null, currency: 'EUR', validFrom: '2026-11-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z', conditions: null, perPersonLimit: null,
  category: { id: CATEGORY, slug: 'restaurants', nameDe: 'Küche', nameEn: 'Cuisine' },
  media: [file(1), file(2)], merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
}

const staffRoutes = (extra: Record<string, RouteHandler> = {}) => ({
  '/admin/club-offers/categories': json({ items: [] }),
  [`/admin/club-offers/${ID}`]: json(offer),
  ...extra,
})

// A real super admin's snapshot lists the modules; with none the console shows "no areas granted".
const superadmin = () => staffSnapshot({ isSuperadmin: true, grants: { merchant_offers: true, marketplace_moderation: true } })

const control = () => screen.queryByRole('button', { name: t.clubOffers.makeMain })

describe('the staff offer page', () => {
  it('offers "Make main" to a super admin, on the current slide, and sends that slide’s file', async () => {
    const fetchMock = mockCapabilityFetch(superadmin(), {
      extraRoutes: staffRoutes({ [`/admin/offers/${ID}/main-media`]: json({ media: [file(2), file(1)] }) }),
    })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/admin/angebote-entdecken/${ID}` })
    await screen.findByText('Zwei zum Preis von einem')

    // The first slide already leads, so there is nothing to choose there.
    expect(control()).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: t.clubOffers.gallery.next }))
    expect(control()).toBeEnabled()
    fireEvent.click(control()!)

    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === `/admin/offers/${ID}/main-media`)).toBe(true))
    const call = fetchMock.mock.calls.find(([url]) => String(url) === `/admin/offers/${ID}/main-media`)!
    expect((call[1] as RequestInit).method).toBe('PUT')
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ assetId: file(2).assetId })

    // The gallery now starts with the chosen file, and the control is inert again there.
    await waitFor(() => expect(document.querySelector('img[alt="Bild 2"]')).not.toBeNull())
    await waitFor(() => expect(control()).toBeDisabled())
  })

  it('does NOT offer it to staff who hold merchant_offers but are not a super admin', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: true } }), { extraRoutes: staffRoutes() })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/admin/angebote-entdecken/${ID}` })
    await screen.findByText('Zwei zum Preis von einem')
    // Counter-assertion: the gallery is there, the control is not.
    expect(screen.getByRole('region', { name: t.clubOffers.gallery.region })).toBeInTheDocument()
    expect(control()).toBeNull()
  })

  it('never offers it on a member’s page', async () => {
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: { '/member/offers/categories': json({ items: [] }), [`/member/offers/${ID}`]: json(offer) },
    })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/mitglied/angebote/${ID}` })
    await screen.findByText('Zwei zum Preis von einem')
    expect(screen.getByRole('region', { name: t.clubOffers.gallery.region })).toBeInTheDocument()
    expect(control()).toBeNull()
  })

  it('logs and leaves the gallery alone when the server refuses', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockCapabilityFetch(superadmin(), {
      extraRoutes: staffRoutes({
        [`/admin/offers/${ID}/main-media`]: () => ({
          status: 403, headers: { 'content-type': 'application/problem+json' },
          body: JSON.stringify({ type: 'https://german-world-club.com/problems/insufficient-permission', title: 'x', status: 403 }),
        }),
      }),
    })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/admin/angebote-entdecken/${ID}` })
    await screen.findByText('Zwei zum Preis von einem')
    fireEvent.click(screen.getByRole('button', { name: t.clubOffers.gallery.next }))
    fireEvent.click(control()!)
    await waitFor(() => expect(log.mock.calls.some(([label]) => label === 'OfferDetail.makeMain')).toBe(true))
    expect(control()).toBeEnabled() // still on the second slide, still choosable
    log.mockRestore()
  })
})
