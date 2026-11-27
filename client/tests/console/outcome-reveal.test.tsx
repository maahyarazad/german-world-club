import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'
import { installScrollSpy, settle, type ScrollSpy } from '../helpers/scroll-spy'

/**
 * The admin pages bring their outcome message into view (feature 041, US2):
 * offer categories and push notifications.
 *
 * See tests/member/outcome-reveal.test.tsx for what jsdom can and cannot show.
 * Each case has the assertion that would pass for a page that revealed nothing,
 * turned round.
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

const lastRevealed = () => scroll.revealed().at(-1)!

describe('offer categories', () => {
  const CATEGORY = (slug: string, n: number, visible = true) => ({
    id: `00000000-0000-4000-8000-00000000c0${n}`, slug, nameDe: `De ${slug}`, nameEn: `En ${slug}`,
    position: n * 10, visible, offerCount: n,
  })
  const first = CATEGORY('restaurants', 1)
  const second = CATEGORY('health', 2)

  function open() {
    mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, edit: true, write: true } } }), {
      extraRoutes: {
        '/admin/offer-categories': () => json({ items: [first, second] }),
        // Each rename answers with the category as renamed, whichever one it was.
        [`/admin/offer-categories/${first.id}`]: (options) => json({ ...first, ...JSON.parse(String(options.body)) }),
        [`/admin/offer-categories/${second.id}`]: (options) => json({ ...second, ...JSON.parse(String(options.body)) }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebotskategorien' })
  }

  /** Rename the row at `index` and press its Save. */
  async function rename(index: number, to: string) {
    const german = (await screen.findAllByLabelText(t.adminCategories.nameDe))[index]!
    fireEvent.change(german, { target: { value: to } })
    fireEvent.click(screen.getAllByRole('button', { name: t.adminCategories.save })[index]!)
  }

  it('brings "Saved." into view, and again for a second save while the first is still showing', async () => {
    open()
    await screen.findByText('restaurants')
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    await rename(0, 'Neu')
    expect(await screen.findByText(t.adminCategories.saved)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toHaveAttribute('role', 'alert')
    expect(lastRevealed()).toContainElement(screen.getByText(t.adminCategories.saved))
    const message = lastRevealed()

    // This page does not clear its message between saves: the same element, the
    // same words, still on screen. Only a new outcome tells it apart.
    await rename(1, 'Auch neu')
    await waitFor(() => expect(scroll.revealed()).toHaveLength(2))
    expect(lastRevealed()).toBe(message)
    expect(screen.getAllByText(t.adminCategories.saved)).toHaveLength(1)
  })

  it('reveals nothing for a move, which shows no message', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: `${t.adminCategories.moveDown}: De restaurants` }))
    // Both positions are written; wait for the page to settle after them.
    await waitFor(() => expect(screen.getByRole('button', { name: `${t.adminCategories.moveDown}: De restaurants` })).toBeEnabled())
    await settle()
    expect(screen.queryByText(t.adminCategories.saved)).not.toBeInTheDocument()
    expect(scroll.revealed()).toHaveLength(0)
  })
})

describe('push notifications', () => {
  const NOTIFICATION = {
    id: '11111111-1111-4111-8111-111111111111', kind: 'broadcast', status: 'queued',
    createdAt: '2026-09-24T10:00:00.000Z', sentAt: null, finishedAt: null,
    de: { title: 'T', body: 'B' }, en: { title: 'T', body: 'B' }, destination: null, sentBy: null,
    totals: { pending: 0, sent: 0, delivered: 0, failed: 0, skipped: 0 },
  }

  function open(preview: RouteHandler) {
    mockCapabilityFetch(staffSnapshot({ grants: { mass_messages: true } }), {
      extraRoutes: {
        '/push/test-recipients': () => json({ recipients: [] }),
        '/push/campaigns': () => json({ notifications: [] }),
        '/push/audience': () => json({ members: 1234, devices: 1500 }),
        '/push/campaigns/preview': preview,
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/push' })
  }

  function fillTheMessage() {
    const titles = screen.getAllByLabelText(t.pushAdmin.title)
    const bodies = screen.getAllByLabelText(t.pushAdmin.body)
    fireEvent.change(titles[0]!, { target: { value: 'Titel' } })
    fireEvent.change(bodies[0]!, { target: { value: 'Nachricht' } })
    fireEvent.change(titles[1]!, { target: { value: 'Title' } })
    fireEvent.change(bodies[1]!, { target: { value: 'Message' } })
  }

  it('brings the "queued" notice into view when the rehearsal is accepted, and not before', async () => {
    let release: () => void = () => {}
    open(() => new Promise((resolve) => { release = () => resolve(json(NOTIFICATION, 202)) }))
    await waitFor(() => expect(screen.getByText(t.pushAdmin.pageTitle)).toBeInTheDocument())
    fillTheMessage()
    await settle()
    expect(scroll.revealed()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: t.pushAdmin.sendRehearsal }))
    await settle()
    // The request is still open: no notice, and nothing revealed.
    expect(screen.queryByText(t.pushAdmin.rehearsalQueued)).not.toBeInTheDocument()
    expect(scroll.revealed()).toHaveLength(0)

    release()
    expect(await screen.findByText(t.pushAdmin.rehearsalQueued)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.pushAdmin.rehearsalQueued))
  })
})

describe('a refusal in the same place (US3)', () => {
  const problem = (type: string, status: number) =>
    json({ type: `https://german-world-club.com/problems/${type}`, title: type, status }, status)

  async function addPets(answer: () => ReturnType<typeof json>) {
    const first = {
      id: '00000000-0000-4000-8000-00000000c001', slug: 'restaurants', nameDe: 'De restaurants', nameEn: 'En restaurants',
      position: 10, visible: true, offerCount: 1,
    }
    mockCapabilityFetch(staffSnapshot({ grants: { merchant_offers: { read: true, edit: true, write: true } } }), {
      extraRoutes: {
        '/admin/offer-categories': (options) => (options.method === 'POST' ? answer() : json({ items: [first] })),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/angebotskategorien' })
    await screen.findByText('restaurants')
    fireEvent.change(screen.getByLabelText(t.adminCategories.slug), { target: { value: 'pets' } })
    fireEvent.change(screen.getAllByLabelText(t.adminCategories.nameDe).at(-1)!, { target: { value: 'Haustiere' } })
    fireEvent.change(screen.getAllByLabelText(t.adminCategories.nameEn).at(-1)!, { target: { value: 'Pets' } })
    fireEvent.click(screen.getByRole('button', { name: t.adminCategories.add }))
  }

  it('brings a taken identifier into view', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await addPets(() => problem('conflict', 409))

    expect(await screen.findByText(t.adminCategories.slugTaken)).toBeInTheDocument()
    await waitFor(() => expect(scroll.revealed()).toHaveLength(1))
    expect(lastRevealed()).toContainElement(screen.getByText(t.adminCategories.slugTaken))
    errors.mockRestore()
  })

  it('reveals nothing for a failure the page only logs', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await addPets(() => problem('internal', 500))

    await waitFor(() => expect(errors).toHaveBeenCalled())
    await settle()
    expect(screen.queryByText(t.adminCategories.slugTaken)).not.toBeInTheDocument()
    expect(scroll.revealed()).toHaveLength(0)
    errors.mockRestore()
  })
})
