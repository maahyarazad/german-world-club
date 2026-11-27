import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 042, FR-031, research R20: the staff console had two sibling routes on
 * `/konsole/admin/angebote` (marketplace moderation and the merchant offers list)
 * and the router takes the first, so a super admin could never reach a merchant
 * offer to choose its main media. The merchant offers list now has its own
 * address, the one merchants and partners already use.
 *
 * Both directions are asserted: the new address shows offers, and the old one
 * still shows moderation. A fix that merely swapped which page loses would pass
 * the first half alone.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown) => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const ID = '00000000-0000-4000-8000-0000000000a1'
const CATEGORY = '00000000-0000-4000-8000-00000000c001'
const card = {
  id: ID, title: 'Zwei Kaffee', benefit: { kind: 'percentage', value: 20 }, currency: 'EUR',
  validUntil: '2026-12-31T00:00:00.000Z', categoryId: CATEGORY, soldOut: false, thumbnail: null,
  merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
}
const offer = {
  id: ID, title: 'Zwei Kaffee', description: 'Zwei zum Preis von einem', benefit: { kind: 'percentage', value: 20 },
  regularPriceCents: null, memberPriceCents: null, currency: 'EUR', validFrom: '2026-11-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z', conditions: null, perPersonLimit: null,
  category: { id: CATEGORY, slug: 'restaurants', nameDe: 'Küche', nameEn: 'Cuisine' },
  media: [], merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
}

const routes: Record<string, RouteHandler> = {
  '/admin/club-offers': json({ items: [card], nextCursor: null }),
  '/admin/club-offers/categories': json({ items: [] }),
  [`/admin/club-offers/${ID}`]: json(offer),
  '/admin/marketplace/reports': json({ items: [] }),
  '/admin/marketplace/listings': json({ items: [], nextCursor: null }),
}

const open = (route: string) => {
  mockCapabilityFetch(
    staffSnapshot({ isSuperadmin: true, grants: { marketplace_moderation: true, merchant_offers: true } }),
    { extraRoutes: routes },
  )
  return renderConsole(<ConsoleRoutes />, { route })
}

describe('the staff merchant offers pages', () => {
  it('opens the merchant offers list at its own address', async () => {
    open('/konsole/admin/angebote-entdecken')
    expect(await screen.findByText('Zwei Kaffee')).toBeInTheDocument()
    expect(screen.queryByText(t.marketplaceModeration.title)).toBeNull()
  })

  it('still opens marketplace moderation at /konsole/admin/angebote', async () => {
    open('/konsole/admin/angebote')
    expect(await screen.findByText(t.marketplaceModeration.title)).toBeInTheDocument()
    // Counter-assertion: the two pages no longer collide, so the offers list is not here.
    expect(screen.queryByText('Zwei Kaffee')).toBeNull()
  })

  it('opens an offer from the list address', async () => {
    open(`/konsole/admin/angebote-entdecken/${ID}`)
    expect(await screen.findByText('Zwei zum Preis von einem')).toBeInTheDocument()
  })

  it('keeps an already-pasted detail link working by redirecting it', async () => {
    open(`/konsole/admin/angebote/${ID}`)
    expect(await screen.findByText('Zwei zum Preis von einem')).toBeInTheDocument()
  })

  it('has one sidebar link to each page, not two to the same address', async () => {
    const { container } = open('/konsole/admin')
    await waitFor(() => expect(container.querySelector('nav a[href="/konsole/admin/angebote-entdecken"]')).not.toBeNull())
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'))
    expect(hrefs.filter((h) => h === '/konsole/admin/angebote-entdecken')).toHaveLength(1)
    expect(hrefs.filter((h) => h === '/konsole/admin/angebote')).toHaveLength(1)
  })
})
