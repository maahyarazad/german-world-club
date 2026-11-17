import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { clearCsrfToken } from '../../src/lib/api'
import { renderConsole, mockCapabilityFetch, memberSnapshot } from '../helpers/console'

/**
 * Settings in the member's profile, with the active sessions (feature 027, US1).
 *
 * The page shows what the server says and decides nothing: which sessions exist,
 * which one is this browser, and what ending one does are all the server's. Each
 * case has a counter-assertion — Cancel sends nothing, a failed load shows no list.
 */

const ME = memberSnapshot().id
const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const profile = () => ({
  kind: 'member', id: ME, displayName: 'Arian Geissler', email: 'a@test.invalid', mobile: null,
  birthday: null, gender: null, countryOfResidence: null, bio: null, city: null,
  memberSince: '2025-01-01T00:00:00.000Z', followers: 0, following: 0, handle: null,
  handleChangeableAt: null, avatar: null, links: [], isInfluencer: false,
})

const WEB = '00000000-0000-4000-8000-0000000000a1'
const PHONE = '00000000-0000-4000-8000-0000000000b2'
const device = (id: string, kind: 'web' | 'mobile', label: string, current: boolean) => ({
  id, kind, label, current, firstSeenAt: '2026-11-01T10:00:00.000Z', lastSeenAt: '2026-11-17T09:00:00.000Z',
})

beforeEach(() => clearCsrfToken())
afterEach(() => vi.unstubAllGlobals())

/** A device list the DELETE route really changes, so the reload shows the effect. */
function deviceRoutes(initial = [device(WEB, 'web', 'Chrome on macOS', true), device(PHONE, 'mobile', 'iPhone 15', false)]) {
  let devices = [...initial]
  const deleted: string[] = []
  return {
    deleted,
    routes: {
      '/member/devices': ((options: RequestInit) => {
        if (options.method === 'DELETE') return { status: 204, body: null }
        return { status: 200, body: JSON.stringify({ devices }), headers: { 'content-type': 'application/json' } }
      }),
      [`/member/devices/${PHONE}`]: () => {
        deleted.push(PHONE)
        devices = devices.filter((d) => d.id !== PHONE)
        return { status: 204, body: null }
      },
    },
  }
}

describe('Profile → Settings link', () => {
  it('sits in the same row as Edit profile and points at the Settings page', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: { '/profile/me': json(profile()) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil' })

    const settings = await screen.findByRole('link', { name: t.memberProfile.settings })
    const edit = screen.getByRole('link', { name: t.memberProfile.edit })
    expect(settings).toHaveAttribute('href', '/konsole/mitglied/profil/einstellungen')
    expect(settings.parentElement).toBe(edit.parentElement)
    // The 026 "Devices" link is gone: sessions live under Settings now.
    expect(screen.queryByRole('link', { name: 'Geräte' })).not.toBeInTheDocument()
  })
})

describe('Settings page', () => {
  it('lists the active sessions, marks this device, and terminates another one after confirmation', async () => {
    const { routes, deleted } = deviceRoutes()
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/einstellungen' })

    expect(await screen.findByRole('heading', { name: t.memberSettings.title })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t.memberSettings.sessionsHeading })).toBeInTheDocument()
    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument()
    expect(screen.getByText('iPhone 15')).toBeInTheDocument()
    expect(screen.getByText(t.memberDevices.thisDevice)).toBeInTheDocument()

    // First click only asks; nothing is sent (counter-assertion).
    const buttons = screen.getAllByRole('button', { name: t.memberDevices.signOutDevice })
    fireEvent.click(buttons[1]!)
    expect(deleted).toEqual([])

    fireEvent.click(await screen.findByRole('button', { name: t.memberDevices.confirmEnd }))
    await waitFor(() => expect(deleted).toEqual([PHONE]))
    await waitFor(() => expect(screen.queryByText('iPhone 15')).not.toBeInTheDocument())
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument()
  })

  it('sends nothing when the member cancels', async () => {
    const { routes, deleted } = deviceRoutes()
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/einstellungen' })

    await screen.findByText('iPhone 15')
    fireEvent.click(screen.getAllByRole('button', { name: t.memberDevices.signOutDevice })[1]!)
    fireEvent.click(await screen.findByRole('button', { name: t.memberDevices.cancel }))
    expect(deleted).toEqual([])
    expect(screen.getByText('iPhone 15')).toBeInTheDocument()
  })

  it('shows the load-failed callout and no list when the server refuses, logging rather than showing the refusal', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: {
        '/member/devices': json({ type: 'https://german-world-club.com/problems/internal', title: 'Internal', status: 500, detail: 'secret detail' }, 500),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/einstellungen' })

    expect(await screen.findByText(t.memberDevices.loadFailed)).toBeInTheDocument()
    expect(screen.queryByText('Chrome on macOS')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret detail')
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith('Devices.load'))).toBe(true)
  })

  it('redirects the old 026 address to Settings', async () => {
    const { routes } = deviceRoutes()
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: routes })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/geraete' })
    expect(await screen.findByRole('heading', { name: t.memberSettings.title })).toBeInTheDocument()
  })
})
