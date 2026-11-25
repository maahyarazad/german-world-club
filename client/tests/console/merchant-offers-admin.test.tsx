import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Feature 035, US3 and US4 on the web: the staff pages for stores and categories
 * (controls absent without the grant, a reason required to deactivate) and the
 * redemption reports (totals, the empty state, the merchant filter only for staff).
 */
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200): RouteHandler => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})
const calls = (fetchMock: ReturnType<typeof mockCapabilityFetch>, method: string, path: string) =>
  fetchMock.mock.calls.filter(([url, o]) => String(url) === path && (o as RequestInit)?.method === method)

const STORE = { id: '00000000-0000-4000-8000-0000000000a1', organisationId: '00000000-0000-4000-8000-0000000000b1', displayName: 'Café Test', slug: 'cafe-test', active: true, deactivatedAt: null, deactivationReason: null, offerCount: 3 }
const CATEGORY = (slug: string, n: number, visible = true) => ({ id: `00000000-0000-4000-8000-00000000c0${n}`, slug, nameDe: `De ${slug}`, nameEn: `En ${slug}`, position: n * 10, visible, offerCount: n })

describe('the stores page', () => {
  it('deactivates a store only with a reason, and sends exactly that', async () => {
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, status: true } } }), {
      extraRoutes: {
        '/admin/stores': json({ items: [STORE] }),
        [`/admin/stores/${STORE.id}/active`]: json({ ...STORE, active: false, deactivatedAt: '2026-11-23T10:00:00.000Z', deactivationReason: 'Beschwerden' }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/shops' })

    fireEvent.click(await screen.findByRole('button', { name: t.adminStores.deactivate }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: t.adminStores.deactivate })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Beschwerden' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(calls(fetchMock, 'PUT', `/admin/stores/${STORE.id}/active`)).toHaveLength(1))
    expect(JSON.parse(String((calls(fetchMock, 'PUT', `/admin/stores/${STORE.id}/active`)[0]![1] as RequestInit).body))).toEqual({ active: false, reason: 'Beschwerden' })
    expect(await screen.findByText(t.adminStores.inactive)).toBeInTheDocument()
  })

  it('offers no switch without the status grant — absent, not disabled', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true } } }), { extraRoutes: { '/admin/stores': json({ items: [STORE] }) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/shops' })
    expect(await screen.findByText('Café Test')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.adminStores.deactivate })).toBeNull()
    expect(screen.queryByRole('button', { name: t.adminStores.reactivate })).toBeNull()
  })

  it('reactivates a switched-off store with no reason', async () => {
    const off = { ...STORE, active: false, deactivationReason: 'x' }
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, status: true } } }), {
      extraRoutes: { '/admin/stores': json({ items: [off] }), [`/admin/stores/${STORE.id}/active`]: json(STORE) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/shops' })
    fireEvent.click(await screen.findByRole('button', { name: t.adminStores.reactivate }))
    await waitFor(() => expect(calls(fetchMock, 'PUT', `/admin/stores/${STORE.id}/active`)).toHaveLength(1))
    expect(JSON.parse(String((calls(fetchMock, 'PUT', `/admin/stores/${STORE.id}/active`)[0]![1] as RequestInit).body))).toEqual({ active: true })
  })

  it('shows nothing to someone with no grant at all', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: {} }), { extraRoutes: { '/admin/stores': json({ items: [STORE] }) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/shops' })
    await waitFor(() => expect(screen.queryByText('Café Test')).toBeNull())
  })
})

describe('the categories page', () => {
  const list = { items: [CATEGORY('restaurants', 1), CATEGORY('health', 2, false)] }

  it('lists every category with its count, hidden ones included', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true } } }), { extraRoutes: { '/admin/offer-categories': json(list) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebotskategorien' })
    expect(await screen.findByText('restaurants')).toBeInTheDocument()
    expect(screen.getByText('health')).toBeInTheDocument()
    expect(screen.getByText(t.adminCategories.hidden)).toBeInTheDocument()
    // Read only: no edit or add controls at all.
    expect(screen.queryByRole('button', { name: t.adminCategories.hide })).toBeNull()
    expect(screen.queryByRole('button', { name: t.adminCategories.add })).toBeNull()
  })

  it('hides a category with the edit grant', async () => {
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, edit: true } } }), {
      extraRoutes: { '/admin/offer-categories': json(list), [`/admin/offer-categories/${CATEGORY('restaurants', 1).id}`]: json({ ...CATEGORY('restaurants', 1), visible: false }) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebotskategorien' })
    fireEvent.click((await screen.findAllByRole('button', { name: t.adminCategories.hide }))[0]!)
    const path = `/admin/offer-categories/${CATEGORY('restaurants', 1).id}`
    await waitFor(() => expect(calls(fetchMock, 'PATCH', path)).toHaveLength(1))
    expect(JSON.parse(String((calls(fetchMock, 'PATCH', path)[0]![1] as RequestInit).body))).toEqual({ visible: false })
  })

  it('adds a category only with a valid identifier, with the write grant', async () => {
    const created = CATEGORY('pets', 3)
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, write: true } } }), {
      extraRoutes: { '/admin/offer-categories': (o) => ((o as RequestInit).method === 'POST' ? json(created, 201)(o) : json(list)(o)) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebotskategorien' })
    const add = await screen.findByRole('button', { name: t.adminCategories.add })
    expect(add).toBeDisabled()

    fireEvent.change(screen.getByLabelText(t.adminCategories.slug), { target: { value: 'Bad Slug' } })
    fireEvent.change(screen.getAllByLabelText(t.adminCategories.nameDe).at(-1)!, { target: { value: 'Haustiere' } })
    fireEvent.change(screen.getAllByLabelText(t.adminCategories.nameEn).at(-1)!, { target: { value: 'Pets' } })
    expect(add).toBeDisabled()

    fireEvent.change(screen.getByLabelText(t.adminCategories.slug), { target: { value: 'pets' } })
    expect(add).toBeEnabled()
    fireEvent.click(add)
    await waitFor(() => expect(calls(fetchMock, 'POST', '/admin/offer-categories')).toHaveLength(1))
    expect(await screen.findByText('pets')).toBeInTheDocument()
  })
})

describe('the redemption reports', () => {
  const report = (count: number) => ({
    totals: { count, estimatedSavingCents: count ? 600 : null },
    byOffer: count ? [{ offerId: '00000000-0000-4000-8000-0000000000d1', title: 'Zwei Kaffee', categoryId: CATEGORY('restaurants', 1).id, count }] : [],
    byDay: count ? [{ day: '2026-11-23', count }] : [],
    rows: count ? [{ id: '00000000-0000-4000-8000-0000000000e1', reference: 'GWC-ABCDE-FGHJK', redeemedAt: '2026-11-23T10:00:00.000Z', offerId: '00000000-0000-4000-8000-0000000000d1', offerTitle: 'Zwei Kaffee', categoryId: CATEGORY('restaurants', 1).id, redeemerKind: 'member', redeemerName: '@hanna' }] : [],
    nextCursor: null,
  })
  const merchant = () => ({ kind: 'merchant', id: '00000000-0000-4000-8000-000000000001', displayName: 'Meryem', organisationId: '00000000-0000-4000-8000-000000000002', organisationName: 'Café Test', organisationStatus: 'active', role: 'owner', available: [] })

  it('shows a merchant the totals, who redeemed, and the reference — and no merchant filter', async () => {
    mockCapabilityFetch(merchant(), { extraRoutes: { '/merchant/categories': json({ items: [CATEGORY('restaurants', 1)] }), '/merchant/reports/redemptions': json(report(2)) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/bericht' })
    expect(await screen.findByText('GWC-ABCDE-FGHJK')).toBeInTheDocument()
    expect(screen.getByText('@hanna')).toBeInTheDocument()
    expect(screen.getByText(t.redemptionReport.kinds.member)).toBeInTheDocument()
    expect(screen.queryByLabelText(t.redemptionReport.merchant)).toBeNull()
  })

  it('says there is nothing, once it has heard so, for an empty set — and shows "—" rather than 0 € for no saving', async () => {
    mockCapabilityFetch(merchant(), { extraRoutes: { '/merchant/categories': json({ items: [] }), '/merchant/reports/redemptions': json(report(0)) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant/bericht' })
    expect(await screen.findByText(t.redemptionReport.empty)).toBeInTheDocument()
    expect(screen.getByText(t.redemptionReport.noSaving)).toBeInTheDocument()
  })

  it('gives staff with the grant the merchant filter, and sends it', async () => {
    const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true } } }), {
      extraRoutes: {
        '/admin/offer-categories': json({ items: [CATEGORY('restaurants', 1)] }),
        '/admin/stores': json({ items: [STORE] }),
        '/admin/reports/redemptions': json(report(2)),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/einloesungs-bericht' })
    const select = await screen.findByLabelText(t.redemptionReport.merchant)
    fireEvent.change(select, { target: { value: STORE.organisationId } })
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes(`organisationId=${STORE.organisationId}`))).toBe(true))
  })

  it('refuses staff without the grant the platform report', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { members: { read: true } } }), { extraRoutes: { '/admin/reports/redemptions': json(report(2)) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/einloesungs-bericht' })
    await waitFor(() => expect(screen.queryByText('GWC-ABCDE-FGHJK')).toBeNull())
  })
})
