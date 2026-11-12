import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { t as en } from '../../src/i18n/en'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'

/**
 * Refer & earn on the web (feature 018, US1/US3).
 *
 * The page shows what the server says and decides nothing: the code comes
 * formatted for reading aloud, the balance is a number of XP with no currency,
 * and a refusal is logged rather than shown.
 */

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => () => ({
  status,
  body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const summary = {
  link: { code: '7K3MXQ2T', url: 'https://german-world-club.com/r/7K3MXQ2T', createdAt: '2026-11-01T10:00:00.000Z' },
  xpBalance: 1200,
  counts: { registered: 2, approved: 1, joined: 3, did_not_join: 1 },
}

const referrals = {
  items: [
    {
      id: '00000000-0000-4000-8000-000000000001', refereeName: 'Jana K.', stage: 'did_not_join',
      registeredAt: '2026-11-02T10:00:00.000Z', approvedAt: null, joinedAt: null,
      endedAt: '2026-11-03T10:00:00.000Z', xpAwarded: 100,
    },
  ],
  nextCursor: null,
}

const xp = {
  items: [
    {
      id: '00000000-0000-4000-8000-0000000000a1', kind: 'award', amount: 100, reason: 'referral',
      referralId: '00000000-0000-4000-8000-000000000001', refereeName: 'Jana K.',
      reversesEntryId: null, reversed: false, createdAt: '2026-11-02T10:00:00.000Z',
    },
  ],
  nextCursor: null,
}

const routes = (overrides: Record<string, () => { status?: number; body?: string; headers?: Record<string, string> }> = {}) => ({
  '/referrals': json(summary),
  '/referrals/referrals': json(referrals),
  '/referrals/xp': json(xp),
  '/referrals/link/replace': json({ ...summary, link: { ...summary.link, code: 'ZZZZ2222', url: 'https://german-world-club.com/r/ZZZZ2222' } }),
  ...overrides,
})

describe('Refer & earn', () => {
  it('shows the code formatted for reading aloud, and the balance in XP with no currency', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen' })

    await waitFor(() => expect(screen.getByText('7K3M-XQ2T')).toBeInTheDocument())
    expect(screen.getByText(summary.link.url)).toBeInTheDocument()
    // German grouping, the word XP, and no euro sign anywhere on the page.
    expect(screen.getByText('1.200 XP')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/€/)
  })

  it('formats the balance for the English interface too', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen', locale: 'en' })
    await waitFor(() => expect(screen.getByText('1,200 XP')).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: en.referrals.title })).toBeInTheDocument()
  })

  it('copies the full link', async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen' })

    fireEvent.click(await screen.findByRole('button', { name: t.referrals.copyLink }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(summary.link.url))
    expect(await screen.findByText(t.referrals.copied)).toBeInTheDocument()
  })

  it('asks before replacing the link, and only then posts', async () => {
    const fetchMock = mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen' })

    fireEvent.click(await screen.findByRole('button', { name: t.referrals.replace }))
    const posted = () => fetchMock.mock.calls.some(([url]) => String(url) === '/referrals/link/replace')
    expect(posted()).toBe(false)

    const dialog = await screen.findByRole('dialog', { name: t.referrals.replaceTitle })
    fireEvent.click(within(dialog).getByRole('button', { name: t.referrals.replaceAction }))
    await waitFor(() => expect(screen.getByText('ZZZZ-2222')).toBeInTheDocument())
    expect(posted()).toBe(true)
  })

  it('shows a referral that did not join with its stage and no reason', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes() })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen' })

    expect(await screen.findByText(t.referrals.stages.did_not_join, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getAllByText('Jana K.').length).toBeGreaterThan(0)
    expect(screen.getByText('Empfehlung: Jana K.')).toBeInTheDocument()
  })

  it('shows the load-failed state and keeps nothing of the refusal', async () => {
    // Counter-assertion: the happy paths above are not rendering regardless of the server.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: routes({
        '/referrals': json({ type: 'https://german-world-club.com/problems/internal', title: 'Internal', status: 500, detail: 'secret detail' }, 500),
      }),
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/empfehlen' })

    expect(await screen.findByText(t.referrals.loadFailed)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret detail')
    expect(screen.queryByText('7K3M-XQ2T')).not.toBeInTheDocument()
    expect(errors).toHaveBeenCalledWith('Referrals.load', expect.anything())
    errors.mockRestore()
  })
})
