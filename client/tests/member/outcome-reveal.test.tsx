import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { CATEGORY_DEFS } from '@gwc/contracts/marketplace'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'
import { installScrollSpy, settle, type ScrollSpy } from '../helpers/scroll-spy'

/**
 * The member's pages bring their outcome message into view (feature 041, US1).
 *
 * A save that succeeds shows its message at the top of the page; a person who
 * pressed Save lower down must be taken to it. jsdom has no layout, so these
 * assert WHICH element the page revealed and WHEN, which is the whole of what
 * the page decides; that a message already in view stays put is the browser's
 * `block: 'nearest'`, checked by hand (quickstart.md).
 *
 * Every case has the assertion that would pass for a page that revealed
 * nothing, turned round: nothing on load, nothing while the request is still
 * open, nothing for a refusal the page does not show.
 */

let scroll: ScrollSpy

beforeEach(() => {
  clearCsrfToken()
  scroll = installScrollSpy()
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:preview-${(n += 1)}`)
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  scroll.restore()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

/** A response the test releases by hand, so "while the request is open" can be asserted. */
function held<T>(body: T, status = 200) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return { release, handler: async () => { await gate; return json(body, status) } }
}

const ME = memberSnapshot().id

const profile = () => ({
  kind: 'member', id: ME, displayName: 'Arian Geissler', email: 'a@test.invalid', mobile: null,
  birthday: null, gender: null, countryOfResidence: null, bio: null, city: null,
  memberSince: '2025-01-01T00:00:00.000Z', followers: 0, following: 0, handle: null,
  handleChangeableAt: null, avatar: null, links: [], isInfluencer: false,
})

/** The element the page revealed last, and the words of the message it holds. */
const lastRevealed = () => scroll.revealed().at(-1)!

describe('Edit profile', () => {
  const save = () => screen.getAllByRole('button', { name: t.memberProfile.save })[0]!

  async function open(patch: RouteHandler) {
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: { '/profile/me': (options) => (options.method === 'PATCH' ? patch(options) : json(profile())) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/bearbeiten' })
    await screen.findByRole('button', { name: t.memberProfile.avatarChange })
  }

  it('brings "Saved." into view when the save returns, and not before', async () => {
    const gate = held(profile())
    await open(gate.handler)

    // Counter-assertion: nothing is revealed by the page having loaded.
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(save())
    // Nor while the request is still open, and no message has appeared yet.
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
    expect(screen.queryByText(t.memberProfile.saved)).not.toBeInTheDocument()

    gate.release()
    expect(await screen.findByText(t.memberProfile.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toHaveAttribute('role', 'alert')
    expect(lastRevealed()).toContainElement(screen.getByText(t.memberProfile.saved))
    expect(scroll.options()[0]).toMatchObject({ block: 'nearest' })
  })

  it('brings it into view again for a second save with the same words', async () => {
    await open(() => json(profile()))

    fireEvent.click(save())
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    fireEvent.click(save())
    await waitFor(() => expect(scroll.revealed()).toHaveLength(2))
    expect(lastRevealed()).toContainElement(screen.getByText(t.memberProfile.saved))
  })

  it('reveals nothing for a refusal the page does not show', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await open(() => json({ ...PROBLEMS.INTERNAL, status: 500 }, 500))

    fireEvent.click(save())
    await waitFor(() => expect(errors).toHaveBeenCalledWith('EditProfile.run', expect.anything()))
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
    expect(screen.queryByText(t.memberProfile.saved)).not.toBeInTheDocument()
  })
})

describe('Marketplace', () => {
  const listing = {
    id: 'l1', category: 'general', mode: 'offer', title: 'Bicycle', body: 'A body that is long enough.',
    state: 'active', version: 'v-1', createdAt: '2026-06-01T00:00:00.000Z', stateChangedAt: '2026-06-01T00:00:00.000Z',
    canEdit: true, canPublish: false, moderated: false,
  }
  const full = {
    ...listing,
    contact: { method: 'platform_message', available: true, via: 'inquire' },
    publishedAt: '2026-06-01T00:00:00.000Z', expiresAt: null,
    details: { kind: 'product' }, features: [], media: [],
    owner: { id: 'm1', displayName: 'Me' },
  }

  function routes(patchStatus: 'ok' | 'conflict' = 'ok') {
    const extraRoutes: Record<string, RouteHandler> = {
      '/marketplace/categories': () => json({ categories: Object.values(CATEGORY_DEFS), vehicleFeatures: [] }),
      '/marketplace/terms': () => json({ version: 'v1', acceptedVersion: 'v1' }),
      '/marketplace/listings': (options) => (options.method === 'POST' ? json({ id: 'new-1' }, 201) : json({ items: [], nextCursor: null })),
      '/marketplace/mine': () => json({ items: [listing] }),
      '/marketplace/mine/l1': () => json(full),
      '/marketplace/listings/l1': () => (patchStatus === 'conflict'
        ? json({ type: 'https://german-world-club.com/problems/conflict', title: 'conflict', status: 409 }, 409)
        : json({ ...listing, version: 'v-2' })),
    }
    return extraRoutes
  }

  const dialog = () => document.querySelector('dialog')!

  /** Open My listings, then Edit, and wait for the drawer to be open. */
  async function openEdit(patchStatus: 'ok' | 'conflict' = 'ok') {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(patchStatus) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.myListings }))
    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.edit }))
    await waitFor(() => expect(dialog().hasAttribute('open')).toBe(true))
    fireEvent.change(await screen.findByLabelText(t.memberMarketplace.titleField), { target: { value: 'Bicycle, reduced' } })
  }

  it('brings "Saved" into view once the drawer has closed', async () => {
    await openEdit()
    // Counter-assertion: opening the page and the drawer revealed nothing.
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    // Where the dialog was when the page moved: the message must not be revealed
    // behind a drawer that is still open (FR-005).
    const drawerOpenAtReveal: boolean[] = []
    scroll.spy.mockImplementation(() => { drawerOpenAtReveal.push(dialog().hasAttribute('open')) })

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveChanges }))
    expect(await screen.findByText(t.memberMarketplace.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))

    expect(lastRevealed()).toContainElement(screen.getByText(t.memberMarketplace.saved))
    expect(drawerOpenAtReveal).toEqual([false])
  })

  it('brings "Posted" into view for a new listing', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })

    fireEvent.click(await screen.findByRole('button', { name: t.memberMarketplace.newListing }))
    fireEvent.change(await screen.findByLabelText(t.memberMarketplace.titleField), { target: { value: 'A new bicycle' } })
    fireEvent.change(screen.getByLabelText(t.memberMarketplace.body), { target: { value: 'Not ready for anyone to see.' } })
    fireEvent.change(await screen.findByLabelText('make *'), { target: { value: 'BMW' } })
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.submit }))
    expect(await screen.findByText(t.memberMarketplace.posted)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.memberMarketplace.posted))
  })

  it('reveals nothing when the save is refused and the drawer stays open', async () => {
    await openEdit('conflict')

    fireEvent.click(screen.getByRole('button', { name: t.memberMarketplace.saveChanges }))
    // The refusal is shown inside the drawer, which is not the page's message slot.
    expect(await screen.findByText(t.memberMarketplace.conflict)).toBeInTheDocument()
    await settle()
    expect(scroll.revealed()).toHaveLength(0)
    expect(screen.queryByText(t.memberMarketplace.saved)).not.toBeInTheDocument()
    expect(dialog().hasAttribute('open')).toBe(true)
  })
})

describe('a refusal in the same place (US3)', () => {
  it('brings the page\'s own refusal of a file into view too', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: { '/profile/me': () => json(profile()) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/bearbeiten' })
    await screen.findByRole('button', { name: t.memberProfile.avatarChange })
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    // A type the page refuses before anything is sent: it shows the refusal at the top.
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'cv.pdf', { type: 'application/pdf' })] } })

    expect(await screen.findByText(t.memberThreads.mediaUnsupported)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toHaveAttribute('role', 'alert')
    expect(lastRevealed()).toContainElement(screen.getByText(t.memberThreads.mediaUnsupported))
  })
})
