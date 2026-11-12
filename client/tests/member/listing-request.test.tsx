import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { PROBLEMS } from '@gwc/contracts/errors'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'

/**
 * Sending a request from a listing card (feature 020, US1). The card offers it
 * on someone else's listing; the server decides; a closed listing and "slow
 * down" are the two refusals shown.
 */

afterEach(() => vi.unstubAllGlobals())

const ME = memberSnapshot().id
const OTHER = '00000000-0000-4000-8000-0000000000bb'
const LISTING = '00000000-0000-4000-8000-0000000000e1'
const CONVERSATION = '00000000-0000-4000-8000-0000000000c1'

const json = (body: unknown, status = 200) => () => ({
  status,
  body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const listing = (ownerId: string) => ({
  id: LISTING, title: 'Kinderfahrrad 20 Zoll', body: 'Gesucht', mode: 'request', category: 'general',
  state: 'active', createdAt: '2026-09-23T10:00:00.000Z', owner: { id: ownerId, displayName: 'Judith Schmidt' },
  contact: { method: 'platform_message', available: true }, media: [],
})

function routes(ownerId: string, inquire = json({
  conversationId: CONVERSATION, created: true,
  message: { id: '00000000-0000-4000-8000-0000000000d1', conversationId: CONVERSATION, senderId: ME, body: 'Hallo', createdAt: '2026-11-12T10:00:00.000Z' },
}, 201)) {
  return {
    '/marketplace/categories': json({ categories: [], vehicleFeatures: [] }),
    '/marketplace/listings': json({ items: [listing(ownerId)], nextCursor: null }),
    '/marketplace/terms': json({ version: 'v1', acceptedVersion: null }),
    [`/marketplace/listings/${LISTING}/inquire`]: inquire,
  }
}

async function openAndSend(text: string) {
  fireEvent.click(await screen.findByRole('button', { name: t.memberRequests.send }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.change(within(dialog).getByPlaceholderText(t.memberRequests.placeholder), { target: { value: text } })
  fireEvent.click(within(dialog).getByRole('button', { name: t.memberRequests.submit }))
  return dialog
}

describe('sending a request from a listing', () => {
  it('sends the message and links to the conversation', async () => {
    const fetchMock = mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(OTHER) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await openAndSend('Ich habe eins, kaum benutzt.')

    const link = await screen.findByRole('link', { name: t.memberRequests.openConversation })
    expect(link.getAttribute('href')).toBe(`/konsole/mitglied/nachrichten/${CONVERSATION}`)
    const call = fetchMock.mock.calls.find(([url]) => String(url) === `/marketplace/listings/${LISTING}/inquire`)
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ body: 'Ich habe eins, kaum benutzt.' })
  })

  it('offers nothing on your own listing', async () => {
    // Counter-assertion for the button above.
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(ME) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    await screen.findByText('Kinderfahrrad 20 Zoll')
    expect(screen.queryByRole('button', { name: t.memberRequests.send })).not.toBeInTheDocument()
  })

  it('says so when the listing no longer takes requests', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(OTHER, json({ ...PROBLEMS.GONE, detail: 'internal detail' }, 410)) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    const dialog = await openAndSend('Noch da?')
    expect(await within(dialog).findByText(t.memberRequests.closed)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('internal detail')
    errors.mockRestore()
  })

  it('cannot send an empty message', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(OTHER) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied' })
    fireEvent.click(await screen.findByRole('button', { name: t.memberRequests.send }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: t.memberRequests.submit })).toBeDisabled())
  })
})
