import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'
import type { RouteHandler } from '../helpers/console'

/**
 * Membership applications on the members page (/konsole/admin/mitglieder).
 * Viewing needs members.read; deciding needs members.status.
 */
afterEach(() => vi.unstubAllGlobals())

const copy = t.applicationsAdmin
const json = (body: unknown, status = 200) => ({
  body: JSON.stringify(body), status, headers: { 'content-type': 'application/json' },
})
const ID = 'ea0b8a79-d6df-4ba6-9ecf-4169e2a72366'
const APPLICATION = {
  memberId: ID, fullName: 'Maahyar Azad', email: 'applicant@example.com', mobile: '+971585831595',
  birthday: '1990-04-12', gender: 'male', countryOfResidence: 'AE', deviceId: null,
  state: 'pending', submittedAt: '2026-09-25T11:16:16.318Z', reviewedAt: null, denialReason: null,
}

function routes(overrides: Record<string, RouteHandler> = {}) {
  return {
    '/admin/onboarding/applications': () => json({ items: [APPLICATION] }),
    [`/admin/onboarding/applications/${ID}/approve`]: () => json({ ...APPLICATION, state: 'approved' }),
    [`/admin/onboarding/applications/${ID}/deny`]: () => json({ ...APPLICATION, state: 'denied' }),
    ...overrides,
  }
}
const posts = (fetchMock: ReturnType<typeof mockCapabilityFetch>, path: string) =>
  fetchMock.mock.calls.filter(([url, options]) => String(url) === path && (options as RequestInit)?.method === 'POST')

async function open(grants: Record<string, unknown>) {
  const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: grants as never }), { extraRoutes: routes() })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/mitglieder' })
  await screen.findByText('Maahyar Azad')
  return fetchMock
}

describe('membership applications', () => {
  it('lists a pending application with what the applicant entered', async () => {
    await open({ members: { read: true, status: true } })
    expect(screen.getByText('applicant@example.com')).toBeInTheDocument()
    expect(screen.getByText('+971585831595')).toBeInTheDocument()
    expect(screen.getByText('Vereinigte Arabische Emirate')).toBeInTheDocument()
    expect(screen.getByText(copy.faceWeb)).toBeInTheDocument()
  })

  it('approves with one click', async () => {
    const fetchMock = await open({ members: { read: true, status: true } })
    fireEvent.click(screen.getByRole('button', { name: copy.approve }))
    await waitFor(() => expect(posts(fetchMock, `/admin/onboarding/applications/${ID}/approve`)).toHaveLength(1))
  })

  it('denies only with a reason, and sends it', async () => {
    const fetchMock = await open({ members: { read: true, status: true } })
    fireEvent.click(screen.getByRole('button', { name: copy.deny }))
    const confirm = screen.getByRole('button', { name: copy.confirmDeny })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText(copy.denyReason), { target: { value: 'Incomplete details' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(posts(fetchMock, `/admin/onboarding/applications/${ID}/deny`)).toHaveLength(1))
    const [, options] = posts(fetchMock, `/admin/onboarding/applications/${ID}/deny`)[0]!
    expect(JSON.parse(String((options as RequestInit).body))).toEqual({ reason: 'Incomplete details' })
  })

  it('shows no decision buttons without members.status', async () => {
    // Counter-assertion: the buttons above are a projection of the grant.
    await open({ members: { read: true } })
    expect(screen.queryByRole('button', { name: copy.approve })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: copy.deny })).not.toBeInTheDocument()
  })
})
