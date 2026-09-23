import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { t } from '../../src/i18n/de'
import { ConsoleRoutes } from '../../src/console/routes'
import { renderConsole, mockCapabilityFetch } from '../helpers/console'

/**
 * A merchant signed in and landed on the member area reading "permissions
 * could not be loaded": the console had no capability route for organisation
 * principals and no portal to put them in. These pin both halves.
 */
const merchantSnapshot = () => ({
  kind: 'merchant',
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Meryem Menne',
  organisationId: '00000000-0000-4000-8000-000000000002',
  organisationName: 'Balnuweit, Gadschiew und Hansen AG',
  organisationStatus: 'pending',
  role: 'owner',
  available: [],
})

describe('the organisation portal', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('loads a merchant snapshot from the merchant route and renders their portal', async () => {
    const fetchMock = mockCapabilityFetch(merchantSnapshot())
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant' })

    expect(await screen.findByRole('heading', { name: 'Balnuweit, Gadschiew und Hansen AG' })).toBeTruthy()
    expect(screen.getByText(t.portals.merchant)).toBeTruthy()
    expect(screen.getByText(`${t.organisationPortal.role}: ${t.organisationPortal.roles.owner}`)).toBeTruthy()

    const asked = fetchMock.mock.calls.map(([url]) => String(url))
    expect(asked).toContain('/auth/merchant/session')
    // Counter-assertion: the failure screen is what the defect showed.
    expect(screen.queryByText(t.console.capabilitiesFailedTitle)).toBeNull()
  })

  it('sends a merchant who reaches the console root to their own portal, not the member area', async () => {
    mockCapabilityFetch(merchantSnapshot())
    renderConsole(<ConsoleRoutes />, { route: '/konsole' })

    expect(await screen.findByRole('heading', { name: 'Balnuweit, Gadschiew und Hansen AG' })).toBeTruthy()
    expect(screen.queryByText(t.memberMarketplace.tabLabel)).toBeNull()
  })

  it('signs out through the merchant route, not the member one', async () => {
    const fetchMock = mockCapabilityFetch(merchantSnapshot())
    renderConsole(<ConsoleRoutes />, { route: '/konsole/merchant' })

    const button = await screen.findByRole('button', { name: t.console.signOut })
    button.click()

    await waitFor(() => {
      const posts = fetchMock.mock.calls
        .filter(([, options]) => (options as RequestInit | undefined)?.method === 'POST')
        .map(([url]) => String(url))
      expect(posts).toContain('/auth/merchant/sign-out')
      expect(posts).not.toContain('/auth/sign-out')
    })
  })
})
