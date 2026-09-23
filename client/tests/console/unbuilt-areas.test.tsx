import { describe, it, expect, afterEach, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { MODULES } from '@gwc/contracts/permissions'
import { ADMIN_ITEMS } from '../../src/console/admin/AdminLayout'
import { t } from '../../src/i18n/de'
import { ConsoleRoutes } from '../../src/console/routes'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from '../helpers/console'

/**
 * An admin area the console has not been built for must not look like a logout.
 *
 * The sidebar is a projection of the permission matrix, and `available` is the
 * SERVER's answer about its own routes — so a module can be granted and
 * servable while the client has no page for it. That gap is expected during
 * build-out.
 *
 * The defect this guards: those paths matched no route, fell through to the
 * top-level `*`, and redirected to `/konsole/anmelden`. A staff member with a
 * perfectly valid session saw the sign-in screen and re-entered credentials
 * for a session they had never lost.
 */

afterEach(() => vi.unstubAllGlobals())

/**
 * Everything the sidebar offers except the dashboard and the areas that ARE
 * built. `marketplace_moderation` got its screen in 008 US4
 * (`console/admin/Marketplace.tsx`) — it renders real content now, not
 * `NotBuilt`'s hint, and asserting the hint against a built screen would make
 * this suite fail for the opposite reason it exists to catch.
 */
const BUILT: readonly string[] = ['marketplace_moderation']
const GATED = ADMIN_ITEMS.filter((item) => item.module && !BUILT.includes(item.module))

describe('an admin area with no page yet', () => {
  it.each(GATED.map((item) => [item.module, item.to]))(
    '%s does not bounce to the sign-in screen',
    async (module, to) => {
      mockCapabilityFetch(staffSnapshot({ grants: { [module as string]: true }, available: MODULES }))
      renderConsole(<ConsoleRoutes />, { route: to as string })

      await waitFor(() => {
        expect(screen.queryByText(t.console.notAvailableHint)).toBeInTheDocument()
      })

      // The counter-assertion, and the actual bug: no sign-in form.
      expect(screen.queryByLabelText(t.signIn.email)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(t.signIn.password)).not.toBeInTheDocument()
    },
  )

  it('keeps the sidebar, so the session is visibly intact', async () => {
    mockCapabilityFetch(staffSnapshot({ grants: { settings: true }, available: MODULES }))
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/einstellungen' })

    await waitFor(() => {
      expect(screen.queryByText(t.console.notAvailableHint)).toBeInTheDocument()
    })
    expect(screen.getByRole('navigation', { name: t.portals.staff })).toBeInTheDocument()
  })

  it('STILL sends a genuinely anonymous visitor to sign in', async () => {
    // Counter-assertion for Elsewhere(): without this the suite would pass
    // against a console that had simply stopped redirecting anyone, ever.
    mockCapabilityFetch(null)
    renderConsole(<ConsoleRoutes />, { route: '/konsole/admin/einstellungen' })

    await waitFor(() => {
      expect(screen.queryByLabelText(t.signIn.email)).toBeInTheDocument()
    })
  })
})
