import { describe, it, expect, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { MODULES, FLAGS } from '@gwc/contracts/permissions'
import { Sidebar } from '../src/console/Sidebar'
import { ADMIN_ITEMS } from '../src/console/admin/AdminLayout'
import RequireGrant from '../src/console/RequireGrant'
import { t } from '../src/i18n/de'
import { renderConsole, mockCapabilityFetch, staffSnapshot } from './helpers/console'

/**
 * SC-002 — the console renders a module for a holder and NOT for a non-holder.
 *
 * The second half is the whole test. A suite that only checked the first would
 * pass, cheerfully and forever, against a console that rendered every module to
 * everyone — which is precisely the defect a capability-driven sidebar exists
 * to prevent. Every case below is therefore a pair.
 */

afterEach(() => vi.unstubAllGlobals())

const sidebar = () => <Sidebar items={ADMIN_ITEMS} title={t.portals.staff} />

/** Every admin sidebar entry that is gated on a module. */
const GATED_ITEMS = ADMIN_ITEMS.filter((item) => item.module)

describe('every module/flag pair renders for a holder and not for a non-holder', () => {
  it.each(GATED_ITEMS.map((item) => [item.module]))(
    'shows %s to a principal who holds it',
    async (module) => {
      mockCapabilityFetch(staffSnapshot({ grants: { [module]: { read: true } } }))
      renderConsole(sidebar())

      const label = t.modules[module]
      await waitFor(() => expect(screen.getByRole('link', { name: label })).toBeInTheDocument())
    },
  )

  it.each(GATED_ITEMS.map((item) => [item.module]))(
    'HIDES %s from a principal who does not hold it',
    async (module) => {
      // Grant one unrelated module so the sidebar renders at all — otherwise
      // this would pass against a component that rendered nothing ever.
      const other = GATED_ITEMS.find((item) => item.module !== module).module

      // `available: MODULES` is load-bearing. With the default (only granted
      // modules servable), an ungranted module would also be un-servable, and
      // the sidebar renders THOSE as plain text rather than a link — so an
      // assertion about links alone would pass even if the grant filter were
      // deleted entirely. Marking everything servable removes that second
      // reason, leaving the grant as the only thing that can hide it.
      mockCapabilityFetch(
        staffSnapshot({ grants: { [other]: { read: true } }, available: MODULES }),
      )
      renderConsole(sidebar())

      await waitFor(() =>
        expect(screen.getByRole('link', { name: t.modules[other] })).toBeInTheDocument(),
      )
      // Absent from the document entirely, not merely absent as a link.
      expect(screen.queryByText(t.modules[module])).not.toBeInTheDocument()
    },
  )
})

describe('the sidebar is derived, never defaulted', () => {
  it('renders nothing gated for a principal holding no grants at all', async () => {
    // The counter-assertion account. A console that showed a full sidebar here
    // would have a defect no positive test could catch.
    mockCapabilityFetch(staffSnapshot({ grants: {}, available: MODULES }))
    renderConsole(sidebar())

    await waitFor(() => expect(screen.getByRole('navigation')).toBeInTheDocument())
    for (const item of GATED_ITEMS) {
      expect(screen.queryByText(t.modules[item.module])).not.toBeInTheDocument()
    }
  })

  it('shows every gated item to a superadmin', async () => {
    mockCapabilityFetch(
      staffSnapshot({
        grants: Object.fromEntries(MODULES.map((m) => [m, true])),
        isSuperadmin: true,
      }),
    )
    renderConsole(sidebar())

    for (const item of GATED_ITEMS) {
      await waitFor(() =>
        expect(screen.getByRole('link', { name: t.modules[item.module] })).toBeInTheDocument(),
      )
    }
  })

  /**
   * SC-001. A module the principal holds but the server cannot serve must be
   * visible and marked, never a dead link — and never silently missing either,
   * which would leave a staff member wondering where their grant went.
   */
  it('marks a held-but-unavailable module instead of linking to it', async () => {
    mockCapabilityFetch(
      staffSnapshot({ grants: { seo: { read: true }, events: { read: true } }, available: ['seo'] }),
    )
    renderConsole(sidebar())

    await waitFor(() =>
      expect(screen.getByRole('link', { name: t.modules.seo })).toBeInTheDocument(),
    )

    // Present...
    expect(screen.getByText(new RegExp(t.modules.events))).toBeInTheDocument()
    // ...but not a link.
    expect(screen.queryByRole('link', { name: t.modules.events })).not.toBeInTheDocument()
  })
})

describe('RequireGrant gates on the exact flag, not on the module', () => {
  const Secret = () => <p>geheimer inhalt</p>

  it.each(FLAGS)('renders for a principal holding %s', async (flag) => {
    mockCapabilityFetch(staffSnapshot({ grants: { seo: { [flag]: true } } }))
    renderConsole(
      <RequireGrant module="seo" flag={flag}>
        <Secret />
      </RequireGrant>,
    )
    await waitFor(() => expect(screen.getByText('geheimer inhalt')).toBeInTheDocument())
  })

  it.each(FLAGS)('does NOT render for a principal holding every flag except %s', async (flag) => {
    const others = Object.fromEntries(FLAGS.filter((f) => f !== flag).map((f) => [f, true]))
    mockCapabilityFetch(staffSnapshot({ grants: { seo: others } }))
    renderConsole(
      <RequireGrant module="seo" flag={flag}>
        <Secret />
      </RequireGrant>,
    )

    // Wait for the snapshot to land before asserting absence — otherwise this
    // would pass merely because nothing had rendered yet.
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('geheimer inhalt')).not.toBeInTheDocument()
  })
})
