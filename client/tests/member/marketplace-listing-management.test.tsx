import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Editing your own listings and the Publish checkbox (feature 037, US1 and US2).
 *
 * The server decides what may be done (`canEdit`, `canPublish`, `moderated`);
 * these tests pin that the screens only DRAW those flags, send `version` back,
 * send `published` only when the member changed it, and say so when the form is
 * out of date.
 */

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})
const problem = (type: string, status: number) =>
  json({ type: `https://german-world-club.com/problems/${type}`, title: type, status }, status)

type Call = { key: string; body: Record<string, unknown> }

const summary = (over: Record<string, unknown>) => ({
  id: 'l1', category: 'general', mode: 'offer', title: 'Bicycle', body: 'A body that is long enough.',
  state: 'active', version: 'v-1', createdAt: '2026-06-01T00:00:00.000Z', stateChangedAt: '2026-06-01T00:00:00.000Z',
  canEdit: true, canPublish: false, moderated: false, ...over,
})

const full = (over: Record<string, unknown> = {}) => ({
  ...summary(over),
  contact: { method: 'platform_message', available: true, via: 'inquire' },
  publishedAt: '2026-06-01T00:00:00.000Z', expiresAt: null,
  details: { kind: 'product' }, features: [], media: [],
  owner: { id: 'm1', displayName: 'Me' },
  ...over,
})

function routes({ mine = [summary({})], one = full(), mineFails = false, patchOutcome = 'ok' as 'ok' | 'conflict' } = {}) {
  const calls: Call[] = []
  const extraRoutes: Record<string, RouteHandler> = {
    '/marketplace/categories': () => json({ categories: Object.values(CATEGORY_DEFS), vehicleFeatures: [] }),
    '/marketplace/terms': () => json({ version: 'v1', acceptedVersion: 'v1' }),
    '/marketplace/listings': (options) => {
      if (options.method === 'POST') {
        calls.push({ key: 'POST /marketplace/listings', body: JSON.parse(String(options.body)) })
        return json({ id: 'new-1' }, 201)
      }
      return json({ items: [], nextCursor: null })
    },
    '/marketplace/mine': () => (mineFails ? problem('internal', 500) : json({ items: mine })),
    '/marketplace/mine/l1': () => json(one),
    '/marketplace/listings/l1': (options) => {
      calls.push({ key: 'PATCH /marketplace/listings/l1', body: JSON.parse(String(options.body)) })
      return patchOutcome === 'conflict'
        ? problem('conflict', 409)
        : json({ ...summary({ version: 'v-2', state: 'active' }) })
    },
  }
  return { calls, extraRoutes }
}

const poster = () => ({ ...memberSnapshot(), permissions: [] as string[] })
const dialog = () => document.querySelector('dialog')!

async function openMine() {
  fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.myListings }))
}

describe('the Publish checkbox on a new listing', () => {
  it('starts ticked, and an unticked box sends publish: false and says it saves a draft', async () => {
    const { calls, extraRoutes } = routes()
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.newListing }))
    const box = await screen.findByRole('checkbox', { name: new RegExp(t.memberMarketplace.publish) })
    expect(box).toBeChecked()
    // The ticked label is the publishing one — the counter-assertion for the draft label below.
    expect(screen.getByRole('button', { name: t.memberMarketplace.submit })).toBeInTheDocument()

    fireEvent.click(box)
    expect(screen.getByRole('button', { name: t.memberMarketplace.saveDraft })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.memberMarketplace.submit })).not.toBeInTheDocument()

    fireEvent.change(await screen.findByLabelText(t.memberMarketplace.titleField), { target: { value: 'Private draft' } })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.body), { target: { value: 'Not ready for anyone to see.' } })
    fireEvent.change(await screen.findByLabelText('make *'), { target: { value: 'BMW' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveDraft }))

    await waitFor(() => expect(calls.some((c) => c.key === 'POST /marketplace/listings')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /marketplace/listings')!.body.publish).toBe(false)
  })
})

describe('My listings', () => {
  it('shows every state, and offers Edit only where the server says canEdit', async () => {
    const { extraRoutes } = routes({
      mine: [
        summary({ id: 'l1', title: 'Live bicycle', state: 'active' }),
        summary({ id: 'l2', title: 'Sold chair', state: 'sold', canEdit: false }),
        summary({ id: 'l3', title: 'Taken down', state: 'hidden', canEdit: false, moderated: true }),
      ],
    })
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await openMine()

    expect(await screen.findByText('Live bicycle')).toBeInTheDocument()
    expect(screen.getByText('Sold chair')).toBeInTheDocument()
    // Only the editable one has a button (the counter-assertion: it has one).
    expect(screen.getAllByRole('button', { name: t.memberMarketplace.edit })).toHaveLength(1)
    // A disabled listing says so, and never says why.
    expect(screen.getByText(t.memberMarketplace.publishDisabledByStaff)).toBeInTheDocument()
    expect(screen.getByText(t.memberMarketplace.states.hidden)).toBeInTheDocument()
  })

  it('says the list could not be loaded instead of claiming it is empty', async () => {
    const { extraRoutes } = routes({ mineFails: true })
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await openMine()

    expect(await screen.findByText(t.memberMarketplace.myListingsLoadFailed)).toBeInTheDocument()
    expect(screen.queryByText(t.memberMarketplace.myListingsEmpty)).not.toBeInTheDocument()
  })

  it('says it is empty only when it really is', async () => {
    const { extraRoutes } = routes({ mine: [] })
    mockCapabilityFetch(poster(), { extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await openMine()
    expect(await screen.findByText(t.memberMarketplace.myListingsEmpty)).toBeInTheDocument()
  })
})

describe('editing a listing', () => {
  async function openEdit(opts: Parameters<typeof routes>[0] = {}) {
    const r = routes(opts)
    mockCapabilityFetch(poster(), { extraRoutes: r.extraRoutes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await openMine()
    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.edit }))
    await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true))
    return r
  }

  it('prefills from the server, sends the version, and sends published only when it changed', async () => {
    const { calls } = await openEdit()
    const title = (await screen.findByLabelText(t.memberMarketplace.titleField)) as HTMLInputElement
    expect(title.value).toBe('Bicycle')
    // An active listing's box is ticked.
    expect(screen.getByRole('checkbox', { name: new RegExp(t.memberMarketplace.publish) })).toBeChecked()

    fireEvent.change(title, { target: { value: 'Bicycle, reduced' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveChanges }))

    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /marketplace/listings/l1')).toBe(true))
    const sent = calls.find((c) => c.key === 'PATCH /marketplace/listings/l1')!.body
    expect(sent.version).toBe('v-1')
    expect(sent.title).toBe('Bicycle, reduced')
    // Unchanged, so not sent — and never a server-only field.
    expect(sent).not.toHaveProperty('published')
    expect(sent).not.toHaveProperty('expiresAt')
    expect(sent).not.toHaveProperty('mode')
  })

  it('sends published: false when the member unticks Publish', async () => {
    const { calls } = await openEdit()
    fireEvent.click(await screen.findByRole('checkbox', { name: new RegExp(t.memberMarketplace.publish) }))
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveChanges }))
    await waitFor(() => expect(calls.some((c) => c.key === 'PATCH /marketplace/listings/l1')).toBe(true))
    expect(calls.find((c) => c.key === 'PATCH /marketplace/listings/l1')!.body.published).toBe(false)
  })

  it('offers a reload instead of overwriting when the listing changed elsewhere', async () => {
    const { calls } = await openEdit({ patchOutcome: 'conflict' })
    fireEvent.change(await screen.findByLabelText(t.memberMarketplace.titleField), { target: { value: 'Stale edit' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveChanges }))

    expect(await screen.findByText(t.memberMarketplace.conflict)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.memberMarketplace.reload })).toBeInTheDocument()
    // Saving again is not offered until the form is reloaded.
    expect(screen.getByRole('button', { name: t.memberMarketplace.saveChanges })).toBeDisabled()
    expect(calls.filter((c) => c.key.startsWith('PATCH'))).toHaveLength(1)
  })

  it('shows a staff-disabled listing as disabled with Publish off, and cannot be saved', async () => {
    await openEdit({
      mine: [summary({ state: 'hidden', canEdit: true })],
      one: full({ state: 'hidden', canEdit: false, canPublish: false, moderated: true }),
    })
    expect((await screen.findAllByText(t.memberMarketplace.publishDisabledByStaff)).length).toBeGreaterThan(0)
    expect(screen.getByRole('checkbox', { name: new RegExp(t.memberMarketplace.publish) })).toBeDisabled()
    expect(screen.getByRole('button', { name: t.memberMarketplace.saveChanges })).toBeDisabled()
  })
})
