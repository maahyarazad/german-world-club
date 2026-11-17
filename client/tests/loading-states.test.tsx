import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ConsoleRoutes } from '../src/console/routes'
import { t } from '../src/i18n/de'
import { clearCsrfToken } from '../src/lib/api'
import { renderConsole, mockCapabilityFetch, staffSnapshot, memberSnapshot } from './helpers/console'

/**
 * Waiting, on screen (feature 030).
 *
 * A page whose data is on its way shows the loader (never a blank page, never a
 * false "nothing here"), a button whose request is running says so and sends
 * once, and a source scan keeps the next page from forgetting. Each case has a
 * counter-assertion.
 */
beforeEach(() => clearCsrfToken())
afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

/** A request the test releases by hand. */
function held<T>(body: T) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  return { release, handler: async () => { await gate; return json(body) } }
}

const ADMINS = { admins: [{
  id: '00000000-0000-4000-8000-0000000000b2', email: 'staff@test.invalid', displayName: null, role: 'staff', isActive: true,
  version: 'v1', current: false, grants: {},
  constraints: { changeRole: { allowed: true }, setActive: { allowed: true }, editGrants: { allowed: true } },
}] }

const superadmin = () => staffSnapshot({ isSuperadmin: true, grants: { admins: true } })

describe('a page waiting for its data', () => {
  it('shows the loader, then replaces it with the content when the data arrives', async () => {
    const gate = held(ADMINS)
    mockCapabilityFetch(superadmin(), { extraRoutes: { '/admin/admins': gate.handler } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    expect(await screen.findByRole('status')).toHaveTextContent(t.console.loading)
    // Counter-assertion: the content is not there yet, and the false "empty" message is not either.
    expect(screen.queryByText('staff@test.invalid')).not.toBeInTheDocument()
    expect(screen.queryByText(t.adminRoles.empty)).not.toBeInTheDocument()

    gate.release()
    expect(await screen.findByText('staff@test.invalid')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows no loader at all for a response inside the grace period', async () => {
    mockCapabilityFetch(superadmin(), { extraRoutes: { '/admin/admins': () => json(ADMINS) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })
    expect(await screen.findByText('staff@test.invalid')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('replaces the loader with the page\'s own failure state when the request fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(superadmin(), {
      extraRoutes: { '/admin/admins': () => json({ type: 'https://german-world-club.com/problems/internal', title: 'x', status: 500 }, 500) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })
    expect(await screen.findByText(t.adminRoles.loadFailed)).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('does the same on the superadmin dashboard', async () => {
    const gate = held({ asOf: '2026-11-17T10:00:00.000Z', figures: [{ key: 'activeMembers', value: 5 }] })
    mockCapabilityFetch(superadmin(), { extraRoutes: { '/admin/dashboard/figures': gate.handler } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin' })
    expect(await screen.findByRole('status')).toBeInTheDocument()
    gate.release()
    expect(await screen.findByText(t.adminDashboard.figures.activeMembers)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does the same for the member\'s own profile', async () => {
    const profile = {
      kind: 'member', id: memberSnapshot().id, displayName: 'Arian', email: 'a@test.invalid', mobile: null, birthday: null,
      gender: null, countryOfResidence: null, bio: null, city: null, memberSince: '2025-01-01T00:00:00.000Z',
      followers: 0, following: 0, handle: null, handleChangeableAt: null, avatar: null, links: [], isInfluencer: false,
    }
    const gate = held(profile)
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: {
        '/profile/me': gate.handler,
        [`/threads/members/${profile.id}/posts`]: () => json({ items: [], next: null }),
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil' })
    expect(await screen.findByRole('status')).toBeInTheDocument()
    gate.release()
    expect(await screen.findByText('Arian')).toBeInTheDocument()
  })
})

describe('a button whose request is running', () => {
  const PHONE = '00000000-0000-4000-8000-0000000000b2'
  const devices = {
    devices: [
      { id: '00000000-0000-4000-8000-0000000000a1', kind: 'web', label: 'Chrome on macOS', current: true, firstSeenAt: '2026-11-01T10:00:00.000Z', lastSeenAt: '2026-11-17T09:00:00.000Z' },
      { id: PHONE, kind: 'mobile', label: 'iPhone 15', current: false, firstSeenAt: '2026-11-01T10:00:00.000Z', lastSeenAt: '2026-11-17T09:00:00.000Z' },
    ],
  }

  it('shows the loader inside itself, is disabled and sends once however often it is pressed', async () => {
    const gate = held(null)
    let released = false
    const deletes: string[] = []
    mockCapabilityFetch(memberSnapshot(), {
      extraRoutes: {
        // The list reflects the delete once it has happened, as the real server's does.
        '/member/devices': () => json({ devices: devices.devices.filter((d) => !(deletes.includes(d.id) && released)) }),
        [`/member/devices/${PHONE}`]: async () => { deletes.push(PHONE); await gate.handler(); return { status: 204, body: null } },
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/einstellungen' })

    await screen.findByText('iPhone 15')
    fireEvent.click(screen.getAllByRole('button', { name: t.memberDevices.signOutDevice })[1]!)
    const confirm = await screen.findByRole('button', { name: t.memberDevices.confirmEnd })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    // The row goes back to its terminate button, now busy.
    const busy = await waitFor(() => {
      const b = screen.getAllByRole('button').find((el) => el.getAttribute('aria-busy') === 'true')
      expect(b).toBeTruthy()
      return b!
    })
    expect(busy).toBeDisabled()
    expect(busy.querySelector('svg[data-spinner="xs"]')).not.toBeNull()
    expect(busy.textContent).toBe(t.memberDevices.signOutDevice) // the label keeps its place: no size change
    expect(deletes).toEqual([PHONE])

    released = true
    gate.release()
    await waitFor(() => expect(screen.queryByText('iPhone 15')).not.toBeInTheDocument())
  })

  it('never shows the loader on a button with no request behind it (counter-assertion)', async () => {
    mockCapabilityFetch(memberSnapshot(), { extraRoutes: { '/member/devices': () => json(devices) } })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/mitglied/profil/einstellungen' })
    await screen.findByText('iPhone 15')
    fireEvent.click(screen.getAllByRole('button', { name: t.memberDevices.signOutDevice })[1]!) // only asks
    fireEvent.click(await screen.findByRole('button', { name: t.memberDevices.cancel }))
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0)
    expect(document.querySelectorAll('button svg[data-spinner]')).toHaveLength(0)
  })

  it('shows the loader on Roles → Save while it saves', async () => {
    const gate = held(ADMINS.admins[0])
    mockCapabilityFetch(superadmin(), {
      extraRoutes: {
        '/admin/admins': () => json(ADMINS),
        [`/admin/admins/${ADMINS.admins[0]!.id}`]: gate.handler,
      },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })
    fireEvent.change(await screen.findByLabelText(t.adminRoles.roleLabel), { target: { value: 'administrator' } })
    const save = screen.getByRole('button', { name: t.adminRoles.save })
    fireEvent.click(save)
    await waitFor(() => expect(save).toHaveAttribute('aria-busy', 'true'))
    expect(save).toBeDisabled()
    gate.release()
    await waitFor(() => expect(save).not.toHaveAttribute('aria-busy'))
  })
})

/**
 * The source scan (plan R5): a console component that calls the API must not
 * render nothing while its data is on the way.
 */
const SRC = join(import.meta.dirname, '../src')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
  })

const CALLS_API = /\b(get|post|patch|put|del|upload)\(|[A-Za-z]+Api\.[a-z]+\(/
const RENDERS_NOTHING_WHILE_LOADING = /if \(!\w+(\.\w+)*\) return null/

/** Components that legitimately render nothing when a value is absent; each with its reason. */
const ALLOWED: Record<string, string> = {
  'member/ListingRequest.tsx': 'renders nothing when the viewer cannot request (owner, no contact), not while loading',
  'member/threads/PostBody.tsx': 'renders nothing for an empty body; the body arrives with the post',
  'console/routes.tsx': 'Elsewhere/ApplicantOnly gates render the loader; the remaining `return null` is the AbortError branch in capabilities',
  'lib/capabilities.tsx': 'returns null from a catch for an aborted request, not from render',
  'onboarding/Profiling.tsx': 'returns null after onComplete() already fired for the German branch',
}

describe('the source scan', () => {
  const candidates = files(SRC)
    .map((path) => ({ rel: relative(SRC, path), source: readFileSync(path, 'utf8') }))
    .filter(({ rel, source }) => CALLS_API.test(source) && !(rel in ALLOWED))

  it('actually reads the sources (a broken glob passes vacuously)', () => {
    expect(files(SRC).length).toBeGreaterThan(60)
    expect(candidates.length).toBeGreaterThan(25)
  })

  it('has no component that calls the API and renders nothing while loading', () => {
    const offenders = candidates
      .filter(({ source }) => RENDERS_NOTHING_WHILE_LOADING.test(source))
      .map(({ rel }) => rel)
    expect(offenders, `These render nothing while loading; use <PageLoader />: ${offenders.join(', ')}`).toEqual([])
  })

  it('keeps the allow-list honest: every entry still exists', () => {
    for (const rel of Object.keys(ALLOWED)) expect(() => readFileSync(join(SRC, rel), 'utf8'), rel).not.toThrow()
  })
})
