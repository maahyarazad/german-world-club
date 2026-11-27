import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'
import { installScrollSpy, settle, type ScrollSpy } from '../helpers/scroll-spy'

/**
 * The merchant and partner pages bring their outcome message into view
 * (feature 041, US2): the organisation profile, the store and the offer editor.
 *
 * See tests/member/outcome-reveal.test.tsx for what jsdom can and cannot show.
 * Each case has the assertion that would pass for a page that revealed nothing,
 * turned round: nothing on load, nothing while the request is open, nothing for
 * a refusal the page does not show, nothing when the page navigates away.
 */

let scroll: ScrollSpy

beforeEach(() => { clearCsrfToken(); scroll = installScrollSpy() })
afterEach(() => {
  scroll.restore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const json = (body: unknown, status = 200) => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

/** A response the test releases by hand, so "while the request is open" can be asserted. */
function held<T>(body: T) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return { release, handler: async () => { await gate; return json(body) } }
}

const isWrite = (options: RequestInit) => options.method !== undefined && options.method !== 'GET'
const lastRevealed = () => scroll.revealed().at(-1)!

describe('the organisation profile', () => {
  const partnerSnapshot = () => ({
    kind: 'partner', id: '00000000-0000-4000-8000-000000000001', displayName: 'Pia Partner',
    organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Partner AG',
    organisationStatus: 'active', role: 'owner', available: [],
  })
  const profile = {
    kind: 'partner', id: '00000000-0000-4000-8000-000000000001', displayName: 'Pia Partner', email: 'pia@test.invalid',
    role: 'owner', organisation: { id: '00000000-0000-4000-8000-000000000002', name: 'Partner AG', status: 'active' },
    publicProfile: { slug: 'partner-ag', kind: 'partner', displayName: 'Partner AG', about: null, website: null, city: null, logo: null },
    canEdit: true,
  }

  async function open(patch: RouteHandler) {
    mockCapabilityFetch(partnerSnapshot(), {
      extraRoutes: {
        '/profile/partner': () => json(profile),
        '/profile/partner/public': patch,
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/partner/profil' })
    return screen.findByRole('button', { name: t.organisationProfile.save })
  }

  it('brings "Saved." into view when the save returns, and not before', async () => {
    const gate = held(profile)
    const save = await open(gate.handler)
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(save)
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
    expect(screen.queryByText(t.organisationProfile.saved)).not.toBeInTheDocument()

    gate.release()
    expect(await screen.findByText(t.organisationProfile.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toHaveAttribute('role', 'alert')
    expect(lastRevealed()).toContainElement(screen.getByText(t.organisationProfile.saved))
  })

  it('reveals nothing for a refusal the page does not show', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = await open(() => json({ ...PROBLEMS.INTERNAL, status: 500 }, 500))

    fireEvent.click(save)
    await waitFor(() => expect(errors).toHaveBeenCalledWith('OrganisationProfile.save', expect.anything()))
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
  })
})

describe('the merchant store', () => {
  const merchantSnapshot = () => ({
    kind: 'merchant', id: '00000000-0000-4000-8000-000000000001', displayName: 'Meryem Menne',
    organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Café Test',
    organisationStatus: 'active', role: 'owner', available: [],
  })
  const store = {
    id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Café Test', logo: null, description: 'Gutes Essen',
    cover: null, media: [], openingHours: 'Mo-Fr 9-18', active: true, deactivationNotice: null,
    version: '2026-11-23T10:00:00.000000Z',
  }

  async function open(patch: RouteHandler) {
    mockCapabilityFetch(merchantSnapshot(), {
      extraRoutes: { '/merchant/store': (options) => (isWrite(options) ? patch(options) : json(store)) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/shop' })
    return screen.findByRole('button', { name: t.merchantStore.save })
  }

  it('brings "Saved." into view, and again for a second save', async () => {
    const gate = held(store)
    const save = await open(gate.handler)
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(save)
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    gate.release()
    expect(await screen.findByText(t.merchantStore.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantStore.saved))

    // The store page clears its message when a request starts, so the second
    // one is a new message after a gap.
    fireEvent.click(screen.getByRole('button', { name: t.merchantStore.save }))
    await waitFor(() => expect(scroll.revealed()).toHaveLength(2))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantStore.saved))
  })

  it('reveals nothing for a refusal the page does not show', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const save = await open(() => json({ ...PROBLEMS.INTERNAL, status: 500 }, 500))

    fireEvent.click(save)
    await waitFor(() => expect(errors).toHaveBeenCalledWith('StorePage.run', expect.anything()))
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
    expect(screen.queryByText(t.merchantStore.saved)).not.toBeInTheDocument()
  })
})

describe('the offer editor', () => {
  const merchantSnapshot = () => ({
    kind: 'merchant', id: '00000000-0000-4000-8000-000000000001', displayName: 'Meryem Menne',
    organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Café Test',
    organisationStatus: 'active', role: 'owner', available: [],
  })
  const category = {
    id: '00000000-0000-4000-8000-00000000c001', slug: 'restaurants', nameDe: 'Restaurants', nameEn: 'Restaurants',
    position: 10, visible: true, offerCount: 1,
  }
  const offer = {
    id: '00000000-0000-4000-8000-0000000000d1', state: 'draft', title: 'Zwei Kaffee', description: null,
    categoryId: category.id, benefit: { kind: 'freebie', value: null }, regularPriceCents: null, memberPriceCents: null,
    currency: 'EUR', validFrom: '2026-12-01T10:00:00.000Z', validUntil: '2027-01-01T10:00:00.000Z',
    conditions: null, remaining: null, perPersonLimit: 1, sortPosition: 0, publishedAt: null, media: [],
    version: '2026-11-23T10:00:00.000000Z',
  }

  function open(route: string, write: RouteHandler) {
    mockCapabilityFetch(merchantSnapshot(), {
      extraRoutes: {
        '/merchant/categories': () => json({ items: [category] }),
        '/merchant/offers': (options) => (isWrite(options) ? write(options) : json({ items: [offer] })),
        [`/merchant/offers/${offer.id}`]: write,
      },
    })
    renderConsole(<ConsoleRoutes />, { route })
  }

  it('brings "Saved." into view when an existing offer is updated', async () => {
    const gate = held({ ...offer, title: 'Zwei Kaffee, neu', version: '2026-11-23T11:00:00.000000Z' })
    open(`/konsole/merchant/angebote/${offer.id}`, gate.handler)
    const save = await screen.findByRole('button', { name: t.merchantOffers.save })
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.change(screen.getByLabelText(t.merchantOffers.fieldTitle), { target: { value: 'Zwei Kaffee, neu' } })
    fireEvent.click(save)
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    gate.release()
    expect(await screen.findByText(t.merchantOffers.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantOffers.saved))
  })

  it('reveals nothing when creating an offer, which moves to the new offer and shows no message', async () => {
    open('/konsole/merchant/angebote/neu', () => json(offer, 201))
    fireEvent.change(await screen.findByLabelText(t.merchantOffers.fieldTitle), { target: { value: 'Zwei Kaffee' } })
    fireEvent.change(screen.getAllByRole('combobox')[0]!, { target: { value: category.id } })
    fireEvent.change(screen.getByLabelText(t.merchantOffers.validFrom), { target: { value: '2026-12-01T10:00' } })
    fireEvent.change(screen.getByLabelText(t.merchantOffers.validUntil), { target: { value: '2027-01-01T10:00' } })

    fireEvent.click(screen.getByRole('button', { name: t.merchantOffers.save }))
    // The editor for the offer that now exists, with no "Saved." on it.
    expect(await screen.findByText(t.merchantOffers.editorEdit)).toBeInTheDocument()
    await settle()
    expect(screen.queryByText(t.merchantOffers.saved)).not.toBeInTheDocument()
    expect(scroll.revealed()).toHaveLength(0)
  })
})

describe('a refusal in the same place (US3)', () => {
  const merchantSnapshot = () => ({
    kind: 'merchant', id: '00000000-0000-4000-8000-000000000001', displayName: 'Meryem Menne',
    organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Café Test',
    organisationStatus: 'active', role: 'owner', available: [],
  })
  const problem = (type: string, status: number) =>
    json({ type: `https://german-world-club.com/problems/${type}`, title: type, status }, status)
  const category = {
    id: '00000000-0000-4000-8000-00000000c001', slug: 'restaurants', nameDe: 'Restaurants', nameEn: 'Restaurants',
    position: 10, visible: true, offerCount: 1,
  }
  const offer = {
    id: '00000000-0000-4000-8000-0000000000d1', state: 'draft', title: 'Zwei Kaffee', description: null,
    categoryId: category.id, benefit: { kind: 'freebie', value: null }, regularPriceCents: null, memberPriceCents: null,
    currency: 'EUR', validFrom: '2026-12-01T10:00:00.000Z', validUntil: '2027-01-01T10:00:00.000Z',
    conditions: null, remaining: null, perPersonLimit: 1, sortPosition: 0, publishedAt: null, media: [],
    version: '2026-11-23T10:00:00.000000Z',
  }
  const store = {
    id: '00000000-0000-4000-8000-0000000000aa', displayName: 'Café Test', logo: null, description: 'Gutes Essen',
    cover: null, media: [], openingHours: 'Mo-Fr 9-18', active: true, deactivationNotice: null,
    version: '2026-11-23T10:00:00.000000Z',
  }

  it('brings a stale store edit into view', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(merchantSnapshot(), {
      extraRoutes: { '/merchant/store': (options) => (isWrite(options) ? problem('conflict', 409) : json(store)) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/shop' })
    const save = await screen.findByRole('button', { name: t.merchantStore.save })
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(save)
    expect(await screen.findByText(t.merchantStore.conflict)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantStore.conflict))
    errors.mockRestore()
  })

  it('brings a stale offer edit into view', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(merchantSnapshot(), {
      extraRoutes: {
        '/merchant/categories': () => json({ items: [category] }),
        '/merchant/offers': () => json({ items: [offer] }),
        [`/merchant/offers/${offer.id}`]: () => problem('conflict', 409),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/merchant/angebote/${offer.id}` })
    fireEvent.click(await screen.findByRole('button', { name: t.merchantOffers.save }))

    expect(await screen.findByText(t.merchantOffers.refusals.conflict)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantOffers.refusals.conflict))
    errors.mockRestore()
  })

  it('brings the refusal to publish into view, and nothing for a refusal the page does not show', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let refusal = problem('offers/profile-incomplete', 422)
    mockCapabilityFetch(merchantSnapshot(), {
      extraRoutes: {
        '/merchant/offers': () => json({ items: [offer] }),
        [`/merchant/offers/${offer.id}/publish`]: () => refusal,
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/angebote' })
    await screen.findByText('Zwei Kaffee')

    // Counter-assertion first: a refusal the page logs and does not show reveals nothing.
    refusal = problem('internal', 500)
    fireEvent.click(screen.getByRole('button', { name: t.merchantOffers.publish }))
    await waitFor(() => expect(errors).toHaveBeenCalledWith('OffersPage.act', expect.anything()))
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    refusal = problem('offers/profile-incomplete', 422)
    fireEvent.click(screen.getByRole('button', { name: t.merchantOffers.publish }))
    expect(await screen.findByText(t.merchantOffers.refusals.profileIncomplete)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.merchantOffers.refusals.profileIncomplete))

    // The same refusal again, with the first still showing: shown again, so revealed again.
    fireEvent.click(screen.getByRole('button', { name: t.merchantOffers.publish }))
    await waitFor(() => expect(scroll.revealed()).toHaveLength(2))
    errors.mockRestore()
  })
})
