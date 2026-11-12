import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'

/**
 * Messages on the web (feature 020, US3): the inbox says what each
 * conversation is about and what is new; a conversation reads in order and
 * takes a reply; the sidebar counts unread.
 */

afterEach(() => vi.unstubAllGlobals())

const ME = memberSnapshot().id
const OTHER = '00000000-0000-4000-8000-0000000000bb'
const ID = '00000000-0000-4000-8000-0000000000c1'

const json = (body: unknown, status = 200) => () => ({ status, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const conversation = (unreadCount: number) => ({
  id: ID,
  subject: { type: 'marketplace_listing', id: '00000000-0000-4000-8000-0000000000e1', title: 'Kinderfahrrad 20 Zoll' },
  counterpart: { memberId: OTHER, displayName: 'Judith Schmidt', handle: null },
  lastMessage: { senderId: OTHER, excerpt: 'Ja, noch da.', createdAt: '2026-11-12T10:05:00.000Z' },
  createdAt: '2026-11-12T10:00:00.000Z', lastMessageAt: '2026-11-12T10:05:00.000Z', unreadCount,
})

const message = (n: number, senderId: string, body: string) => ({
  id: `00000000-0000-4000-8000-0000000000d${n}`, conversationId: ID, senderId, body, createdAt: `2026-11-12T10:0${n}:00.000Z`,
})

const routes = (unread = 1) => ({
  '/messages/conversations': json({ items: [conversation(unread)], nextCursor: null }),
  [`/messages/conversations/${ID}`]: json({
    conversation: conversation(0),
    participants: [],
    // Newest first, as the server sends them.
    messages: [message(5, OTHER, 'Ja, noch da.'), message(1, ME, 'Noch da?')],
    nextCursor: null,
  }),
  [`/messages/conversations/${ID}/messages`]: json(message(7, ME, 'Super, ich komme heute.'), 201),
})

describe('Messages', () => {
  it('lists each conversation by listing and person, marking what is new', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/nachrichten' })

    expect(await screen.findByText('Kinderfahrrad 20 Zoll')).toBeInTheDocument()
    expect(screen.getByText('Judith Schmidt')).toBeInTheDocument()
    expect(screen.getAllByText('Ja, noch da.').length).toBeGreaterThan(0)
    expect(screen.getByText('1 neu')).toBeInTheDocument()
  })

  it('counts unread messages on the sidebar tab', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes(3) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/nachrichten' })
    const tab = await screen.findByRole('link', { name: /Nachrichten/ })
    await waitFor(() => expect(tab.textContent).toContain('3'))
  })

  it('shows the conversation oldest first and appends a reply', async () => {
    const fetchMock = mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: `/konsole/mitglied/nachrichten/${ID}` })

    const first = await screen.findByText('Noch da?')
    const second = screen.getByText('Ja, noch da.')
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(t.memberMessages.replyPlaceholder), { target: { value: 'Super, ich komme heute.' } })
    fireEvent.click(screen.getByRole('button', { name: t.memberMessages.send }))
    expect(await screen.findByText('Super, ich komme heute.')).toBeInTheDocument()
    const call = fetchMock.mock.calls.find(([url]) => String(url) === `/messages/conversations/${ID}/messages`)
    expect(JSON.parse(String((call![1] as RequestInit).body))).toEqual({ body: 'Super, ich komme heute.' })
  })

  it('shows the empty state and no badge when there is nothing', async () => {
    // Counter-assertion for the list and the badge above.
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: { '/messages/conversations': json({ items: [], nextCursor: null }) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/nachrichten' })
    expect(await screen.findByText(t.memberMessages.empty)).toBeInTheDocument()
    const tab = screen.getByRole('link', { name: /Nachrichten/ })
    expect(tab.textContent).toBe('Nachrichten')
  })
})
