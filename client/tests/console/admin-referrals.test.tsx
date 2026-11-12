import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { ConsoleRoutes } from '../../src/console/routes'
import { t } from '../../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'

/**
 * Staff oversight of referrals (feature 018, US4). Reverse and Disable are
 * absent — not disabled — without `referrals.status`, and absent on the
 * viewer's own record; every action needs a reason before it can be sent.
 */

afterEach(() => vi.unstubAllGlobals())

const STAFF_ID = '00000000-0000-4000-8000-000000000001'
const OTHER_ID = '00000000-0000-4000-8000-0000000000aa'
const json = (body: unknown) => () => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

const owner = (id: string, kind: 'member' | 'admin') => ({
  ownerKind: kind, ownerId: id, name: kind === 'admin' ? 'Test Staff' : 'Rita Referrer',
  link: { id: '00000000-0000-4000-8000-0000000000b1', code: '7K3MXQ2T', state: 'active' },
  xpBalance: 100, counts: { registered: 1, approved: 0, joined: 0, did_not_join: 0 },
})

const award = {
  items: [{
    id: '00000000-0000-4000-8000-0000000000c1', kind: 'award', amount: 100, reason: 'referral',
    referralId: '00000000-0000-4000-8000-0000000000d1', refereeName: 'Jana K.',
    reversesEntryId: null, reversed: false, createdAt: '2026-11-02T10:00:00.000Z',
  }],
  nextCursor: null,
}

function routesFor(o: ReturnType<typeof owner>) {
  const base = `/admin/referrals/owners/${o.ownerKind}/${o.ownerId}`
  return {
    '/admin/referrals/owners': json({ items: [o], nextCursor: null }),
    [base]: json(o),
    [`${base}/referrals`]: json({ items: [], nextCursor: null }),
    [`${base}/xp`]: json(award),
    '/admin/referrals/xp-rate': json({
      current: { xp: 100, effectiveFrom: '2026-11-01T00:00:00.000Z', setBy: null, reason: 'initial rate' },
      history: [{ xp: 100, effectiveFrom: '2026-11-01T00:00:00.000Z', setBy: null, reason: 'initial rate' }],
    }),
    [`/admin/referrals/xp/${award.items[0]!.id}/reverse`]: json({ ...award.items[0], kind: 'reversal', amount: -100 }),
  }
}

async function openOwner(grants: Record<string, boolean>, o = owner(OTHER_ID, 'member')) {
  const fetchMock = mockCapabilityFetch(staffSnapshot({ grants: { referrals: grants } }), { extraRoutes: routesFor(o) })
  renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/empfehlungen' })
  fireEvent.click(await screen.findByRole('button', { name: t.adminReferrals.open }))
  await screen.findByText('Empfehlung: Jana K.')
  return fetchMock
}

describe('referral oversight', () => {
  it('offers Reverse and Disable on somebody else\'s record with status', async () => {
    // Counter-assertion for the absences below.
    await openOwner({ read: true, status: true })
    expect(screen.getByRole('button', { name: t.adminReferrals.reverse })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t.adminReferrals.disableLink })).toBeInTheDocument()
  })

  it('has neither without status', async () => {
    await openOwner({ read: true })
    expect(screen.queryByRole('button', { name: t.adminReferrals.reverse })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.adminReferrals.disableLink })).not.toBeInTheDocument()
  })

  it('has neither on the viewer\'s own record, even with status, and says why', async () => {
    await openOwner({ read: true, status: true }, owner(STAFF_ID, 'admin'))
    expect(screen.queryByRole('button', { name: t.adminReferrals.reverse })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.adminReferrals.disableLink })).not.toBeInTheDocument()
    expect(screen.getByText(t.adminReferrals.ownRecord)).toBeInTheDocument()
  })

  it('will not send a reversal without a reason, and sends the reason it is given', async () => {
    const fetchMock = await openOwner({ read: true, status: true })
    fireEvent.click(screen.getByRole('button', { name: t.adminReferrals.reverse }))
    const dialog = await screen.findByRole('dialog', { name: t.adminReferrals.reverseTitle })
    const confirm = within(dialog).getByRole('button', { name: t.adminReferrals.confirm })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText(t.adminReferrals.reason), { target: { value: 'fake account ring' } })
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/reverse'))
      expect(call && JSON.parse(String((call[1] as RequestInit).body))).toEqual({ reason: 'fake account ring' })
    })
  })

  it('shows the rate change only with edit', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { referrals: { read: true } } }), { extraRoutes: routesFor(owner(OTHER_ID, 'member')) })
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/empfehlungen' })
    expect(await screen.findByText('Aktuell: 100 XP')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t.adminReferrals.rateChange })).not.toBeInTheDocument()
  })
})
