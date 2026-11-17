import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import { clearCsrfToken } from '../../src/lib/api'

/**
 * Roles & permissions (feature 028). The page renders what the server says and
 * decides nothing; each case has its counter-assertion.
 */
afterEach(() => vi.unstubAllGlobals())
beforeEach(() => clearCsrfToken())

const json = (body: unknown, status = 200) => () => ({
  status, body: JSON.stringify(body),
  headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
})

const ME = '00000000-0000-4000-8000-0000000000a1'
const STAFF = '00000000-0000-4000-8000-0000000000b2'
const ALLOWED = { allowed: true }

const account = (overrides: Record<string, unknown>) => ({
  id: STAFF, email: 'staff@test.invalid', displayName: null, role: 'staff', isActive: true,
  version: '2026-11-17T10:00:00.000000Z', current: false, grants: {},
  constraints: { changeRole: ALLOWED, setActive: ALLOWED, editGrants: ALLOWED },
  ...overrides,
})

const list = (...admins: unknown[]) => ({ '/admin/admins': json({ admins }) })

describe('Roles & permissions (view)', () => {
  it('lists each account with role, state and grants, and marks the caller', async () => {
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { admins: true } }), {
      extraRoutes: list(
        account({ id: ME, email: 'chief@test.invalid', displayName: 'Chief', role: 'superadmin', current: true }),
        account({ grants: { events: { read: true, write: false, edit: false, delete: false, status: true } } }),
        account({ id: '00000000-0000-4000-8000-0000000000c3', email: 'off@test.invalid', isActive: false }),
      ),
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    expect(await screen.findByText('Chief')).toBeInTheDocument()
    expect(screen.getByText(t.adminRoles.you)).toBeInTheDocument()
    expect(screen.getByText(t.adminRoles.roles.superadmin, { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('staff@test.invalid')).toBeInTheDocument()
    // Each area shows its five flags as the same words the old dashboard used, ticked where granted.
    const row = screen.getByText(t.modules.events, { selector: 'li > span' }).closest('li')!
    const ticked = within(row).getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)
    expect(ticked).toEqual([true, false, false, false, true]) // read, create, edit, delete, change status
    expect(screen.getByText(t.adminRoles.inactive)).toBeInTheDocument()
    // An area with no grant is not listed, and an account with none says so (counter-assertion).
    expect(screen.queryByText(t.modules.seo, { selector: 'li > span' })).not.toBeInTheDocument()
    expect(screen.getAllByText(t.adminRoles.noGrants).length).toBeGreaterThan(0)
  })

  it('is a real page: the "Not available yet" hint is gone for this area', async () => {
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { admins: true } }), { extraRoutes: list(account({})) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })
    expect(await screen.findByText('staff@test.invalid')).toBeInTheDocument()
    expect(screen.queryByText(t.console.notAvailableHint)).not.toBeInTheDocument()
  })

  it('shows the load-failed callout, logs the refusal, and shows no list', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockCapabilityFetch(staffSnapshot({ isSuperadmin: true, grants: { admins: true } }), {
      extraRoutes: { '/admin/admins': json({ type: 'https://german-world-club.com/problems/internal', title: 'Internal', status: 500, detail: 'secret detail' }, 500) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    expect(await screen.findByText(t.adminRoles.loadFailed)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret detail')
    await waitFor(() => expect(errors.mock.calls.some((c) => String(c[0]).startsWith('Roles.load'))).toBe(true))
  })

  it('shows the not-available callout to a staff member without a grant on the area', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { members: true } }), { extraRoutes: list(account({})) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })
    expect(await screen.findByText(t.console.notAvailable)).toBeInTheDocument()
    expect(screen.queryByText('staff@test.invalid')).not.toBeInTheDocument()
  })
})

const BLOCKED = (reason: string) => ({ allowed: false, reason })
const READ = { read: true, write: false, edit: false, delete: false, status: false }

/** A route that records PATCH bodies and answers with `reply` (or a problem). */
function patchRoute(reply: (body: Record<string, unknown>) => { status?: number; body: unknown }) {
  const sent: Array<Record<string, unknown>> = []
  return {
    sent,
    routes: (admins: unknown[]) => ({
      '/admin/admins': ((options: RequestInit) => {
        if (options.method === 'PATCH') return { status: 405, body: null }
        return { status: 200, body: JSON.stringify({ admins }), headers: { 'content-type': 'application/json' } }
      }),
    }),
    patchRoute: (id: string) => ({
      [`/admin/admins/${id}`]: ((options: RequestInit) => {
        const body = JSON.parse(String(options.body))
        sent.push(body)
        const { status = 200, body: out } = reply(body)
        return {
          status, body: JSON.stringify(out),
          headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
        }
      }),
    }),
  }
}

describe('Roles & permissions (change)', () => {
  const snapshot = () => staffSnapshot({ isSuperadmin: true, grants: { admins: true } })

  it('sends exactly the changed parts with the version, and shows the saved account', async () => {
    const updated = account({ role: 'administrator', version: '2026-11-17T11:00:00.000000Z', grants: { seo: READ } })
    const route = patchRoute(() => ({ body: updated }))
    mockCapabilityFetch(snapshot(), {
      extraRoutes: { ...route.routes([account({ grants: { seo: READ } })]), ...route.patchRoute(STAFF) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    const save = await screen.findByRole('button', { name: t.adminRoles.save })
    // Counter-assertion: nothing to save, nothing to send.
    expect(save).toBeDisabled()

    fireEvent.change(screen.getByLabelText(t.adminRoles.roleLabel), { target: { value: 'administrator' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => expect(route.sent).toHaveLength(1))
    expect(route.sent[0]).toEqual({ version: '2026-11-17T10:00:00.000000Z', role: 'administrator' })
    expect(await screen.findByText(t.adminRoles.roles.administrator, { selector: 'span' })).toBeInTheDocument()
  })

  it('sends a ticked flag as the full five for that area only, and a new area starts with read', async () => {
    const route = patchRoute(() => ({ body: account({ grants: { seo: { ...READ, status: true }, events: READ } }) }))
    mockCapabilityFetch(snapshot(), {
      extraRoutes: { ...route.routes([account({ grants: { seo: READ } })]), ...route.patchRoute(STAFF) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    await screen.findByText(t.modules.seo)
    fireEvent.click(screen.getAllByLabelText(t.flags.status)[0]!)
    fireEvent.change(screen.getByLabelText(t.adminRoles.addArea), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: t.adminRoles.save }))

    await waitFor(() => expect(route.sent).toHaveLength(1))
    expect(route.sent[0]!.grants).toEqual({
      seo: { ...READ, status: true },
      events: READ,
    })
    expect(route.sent[0]).not.toHaveProperty('role')
    expect(route.sent[0]).not.toHaveProperty('isActive')
  })

  it('disables a control the server says is not allowed, with the reason as its tooltip', async () => {
    mockCapabilityFetch(snapshot(), {
      extraRoutes: list(account({
        id: ME, email: 'chief@test.invalid', displayName: 'Chief', role: 'superadmin', current: true,
        constraints: { changeRole: BLOCKED('last-superadmin'), setActive: BLOCKED('last-superadmin'), editGrants: ALLOWED },
      })),
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    const roleSelect = await screen.findByLabelText(t.adminRoles.roleLabel)
    const activeBox = screen.getByLabelText(t.adminRoles.active, { selector: 'input' })
    expect(roleSelect).toBeDisabled()
    expect(activeBox).toBeDisabled()
    // The tooltip is on the wrapper (a disabled control gets no pointer events), and is also in the DOM as text.
    expect(roleSelect.closest('span[title]')).toHaveAttribute('title', t.adminRoles.blockers['last-superadmin'])
    expect(roleSelect.closest('span[title]')?.getAttribute('aria-describedby')).toBeTruthy()
    // Counter-assertion: the allowed control (area picker) is enabled and has no tooltip wrapper.
    expect(screen.getByLabelText(t.adminRoles.addArea)).toBeEnabled()
    expect(screen.getByLabelText(t.adminRoles.addArea).closest('span[title]')).toBeNull()
  })

  it('shows the self reason on the caller\'s own row and the superadmin-required reason on a row the caller cannot manage', async () => {
    mockCapabilityFetch(snapshot(), {
      extraRoutes: list(
        account({ id: ME, displayName: 'Me', current: true, role: 'superadmin',
          constraints: { changeRole: BLOCKED('self'), setActive: BLOCKED('self'), editGrants: ALLOWED } }),
        account({ displayName: 'Other', email: 'other@test.invalid',
          constraints: { changeRole: BLOCKED('superadmin-required'), setActive: BLOCKED('superadmin-required'), editGrants: BLOCKED('superadmin-required') } }),
      ),
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    await screen.findByText('Me')
    const titles = Array.from(document.querySelectorAll('span[title]')).map((el) => el.getAttribute('title'))
    expect(titles).toContain(t.adminRoles.blockers.self)
    expect(titles).toContain(t.adminRoles.blockers['superadmin-required'])
    expect(titles).not.toContain(t.adminRoles.blockers['last-superadmin'])
  })

  it('reloads and says so when the account was changed elsewhere (409), without showing the refusal', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const route = patchRoute(() => ({
      status: 409, body: { type: 'https://german-world-club.com/problems/conflict', title: 'Conflict', status: 409, detail: 'secret detail' },
    }))
    mockCapabilityFetch(snapshot(), {
      extraRoutes: { ...route.routes([account({})]), ...route.patchRoute(STAFF) },
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    fireEvent.change(await screen.findByLabelText(t.adminRoles.roleLabel), { target: { value: 'administrator' } })
    fireEvent.click(screen.getByRole('button', { name: t.adminRoles.save }))

    expect(await screen.findByText(t.adminRoles.changedElsewhere)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('secret detail')
    expect(errors.mock.calls.some((c) => String(c[0]).startsWith('Roles.save'))).toBe(true)
    // The reload put the draft back to what the server has.
    expect((screen.getByLabelText(t.adminRoles.roleLabel) as HTMLSelectElement).value).toBe('staff')
  })

  it('notes that a superadmin\'s grants are bypassed, without disabling the grid', async () => {
    mockCapabilityFetch(snapshot(), {
      extraRoutes: list(account({ role: 'superadmin', grants: { seo: READ } })),
    })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/rollen' })

    expect(await screen.findByText(t.adminRoles.superadminBypass)).toBeInTheDocument()
    expect(within(screen.getByText(t.modules.seo, { selector: 'li > span' }).closest('li')!).getAllByRole('checkbox')[0]).toBeEnabled()
  })
})
