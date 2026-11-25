import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Merchant offers on the web (feature 035, US2): browsing by category, the
 * detail, and redeeming — a refusal in words, a retry that cannot become a
 * second redemption.
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})
const problem = (slug: string, status: number) => json({ type: `https://german-world-club.com/problems/offers/${slug}`, title: slug, status }, status)

const ID = '00000000-0000-4000-8000-0000000000a1'
const category = (n: number, slug: string, count: number) => ({ id: `00000000-0000-4000-8000-00000000c0${n}`, slug, nameDe: slug === 'restaurants' ? 'Küche & Restaurants' : 'Gesundheit', nameEn: slug, offerCount: count })
const item = (soldOut = false) => ({
  id: ID, title: 'Zwei Kaffee', benefit: { kind: 'percentage', value: 20 }, currency: 'EUR',
  validUntil: '2026-12-31T00:00:00.000Z', categoryId: category(1, 'restaurants', 1).id, soldOut, thumbnail: null,
  merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
})
const offer = {
  id: ID, title: 'Zwei Kaffee', description: 'Zwei zum Preis von einem', benefit: { kind: 'percentage', value: 20 },
  regularPriceCents: 1000, memberPriceCents: 800, currency: 'EUR', validFrom: '2026-11-01T00:00:00.000Z',
  validUntil: '2026-12-31T00:00:00.000Z', conditions: 'Nur montags', perPersonLimit: 1,
  category: { id: category(1, 'restaurants', 1).id, slug: 'restaurants', nameDe: 'Küche & Restaurants', nameEn: 'Cuisine' },
  media: [], merchant: { displayName: 'Café Test', slug: 'cafe-test', logo: null },
}
const redemption = { id: '00000000-0000-4000-8000-0000000000b1', reference: 'GWC-ABCDE-FGHJK', redeemedAt: '2026-11-23T10:00:00.000Z', offerId: ID, offerTitle: 'Zwei Kaffee', merchantName: 'Café Test', thumbnailUrl: null }

const base = {
  '/member/offers/categories': json({ items: [category(1, 'restaurants', 1), category(2, 'health', 0)] }),
  '/member/offers': json({ items: [item()], nextCursor: null }),
}
const open = (routes: Record<string, RouteHandler>, route: string) => {
  const fetchMock = mockCapabilityFetch(memberSnapshot(), { extraRoutes: { ...base, ...routes } })
  renderConsole(<ConsoleRoutes />, { route })
  return fetchMock
}
const posts = (fetchMock: ReturnType<typeof mockCapabilityFetch>) =>
  fetchMock.mock.calls.filter(([url, o]) => String(url).endsWith('/redemptions') && (o as RequestInit)?.method === 'POST')

describe('browsing merchant offers', () => {
  it('lists the offers with their merchant and benefit, and the categories with their counts', async () => {
    open({}, '/konsole/mitglied/angebote')
    expect(await screen.findByText('Zwei Kaffee')).toBeInTheDocument()
    expect(screen.getByText('Café Test')).toBeInTheDocument()
    expect(screen.getByText('20 % Rabatt')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Küche & Restaurants (1)' })).toBeInTheDocument()
  })

  it('asks the server for one category when it is chosen', async () => {
    const fetchMock = open({}, '/konsole/mitglied/angebote')
    fireEvent.click(await screen.findByRole('button', { name: 'Küche & Restaurants (1)' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`categoryId=${category(1, 'restaurants', 1).id}`))).toBe(true))
  })

  it('shows a sold-out offer as sold out, not hidden', async () => {
    open({ '/member/offers': json({ items: [item(true)], nextCursor: null }) }, '/konsole/mitglied/angebote')
    expect(await screen.findByText(t.clubOffers.soldOut)).toBeInTheDocument()
  })

  it('says there are no offers when there are none — once it has actually heard so', async () => {
    open({ '/member/offers': json({ items: [], nextCursor: null }) }, '/konsole/mitglied/angebote')
    expect(await screen.findByText(t.clubOffers.empty)).toBeInTheDocument()
  })
})

describe('redeeming an offer', () => {
  const detail = { [`/member/offers/${ID}`]: json(offer) }

  it('shows the reference to take to the store after redeeming', async () => {
    open({ ...detail, [`/member/offers/${ID}/redemptions`]: json(redemption, 201) }, `/konsole/mitglied/angebote/${ID}`)
    fireEvent.click(await screen.findByRole('button', { name: t.clubOffers.redeem }))
    expect(await screen.findByText('GWC-ABCDE-FGHJK')).toBeInTheDocument()
    expect(screen.getByText(t.clubOffers.showAtStore)).toBeInTheDocument()
  })

  it('sends one request for a double tap, and a request id the server can recognise on a retry', async () => {
    const fetchMock = open({ ...detail, [`/member/offers/${ID}/redemptions`]: json(redemption, 201) }, `/konsole/mitglied/angebote/${ID}`)
    const button = await screen.findByRole('button', { name: t.clubOffers.redeem })
    fireEvent.click(button)
    fireEvent.click(button)
    await screen.findByText('GWC-ABCDE-FGHJK')
    expect(posts(fetchMock)).toHaveLength(1)
    const body = JSON.parse(String((posts(fetchMock)[0]![1] as RequestInit).body))
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each([
    ['sold-out', 409, t.clubOffers.refusals.soldOut],
    ['per-person-limit-reached', 409, t.clubOffers.refusals.perPersonLimit],
    ['own-offer', 422, t.clubOffers.refusals.ownOffer],
  ])('says why when the server refuses with %s', async (slug, status, text) => {
    open({ ...detail, [`/member/offers/${ID}/redemptions`]: problem(slug, status) }, `/konsole/mitglied/angebote/${ID}`)
    fireEvent.click(await screen.findByRole('button', { name: t.clubOffers.redeem }))
    expect(await screen.findByText(text)).toBeInTheDocument()
    // Counter-assertion: no reference is shown for a refused redemption.
    expect(screen.queryByText(t.clubOffers.reference)).toBeNull()
  })

  it('says the offer is no longer available when it has gone', async () => {
    open({ [`/member/offers/${ID}`]: problem('not-found', 404) }, `/konsole/mitglied/angebote/${ID}`)
    expect(await screen.findByText(t.clubOffers.refusals.unavailable)).toBeInTheDocument()
  })

  it('lists what the account has redeemed, with the reference', async () => {
    open({ '/member/offers/redemptions': json({ items: [redemption], nextCursor: null }) }, '/konsole/mitglied/einloesungen')
    expect(await screen.findByText('GWC-ABCDE-FGHJK')).toBeInTheDocument()
    expect(screen.getByText('Zwei Kaffee')).toBeInTheDocument()
  })

  it('does not call the list empty while it is still loading', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    open({
      '/member/offers/redemptions': async () => {
        await gate
        return { status: 200, body: JSON.stringify({ items: [], nextCursor: null }), headers: { 'content-type': 'application/json' } }
      },
    }, '/konsole/mitglied/einloesungen')

    // The request is still in flight: no claim that nothing was redeemed.
    await screen.findByRole('heading', { name: t.clubOffers.myRedemptions })
    // (The loader itself is silent for its first 150 ms, so it is not asserted here.)
    expect(screen.queryByText(t.clubOffers.noRedemptions)).toBeNull()

    release()
    // Counter-assertion: once it has answered, the empty message is true and shown.
    expect(await screen.findByText(t.clubOffers.noRedemptions)).toBeInTheDocument()
  })
})
