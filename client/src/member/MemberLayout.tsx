import ConsoleShell from '../console/ConsoleShell'
import type { SidebarItem } from '../console/Sidebar'
import { useTranslations } from '../i18n/index'

/**
 * The member area's tab bar (008 US6), at `/konsole/mitglied` —
 * `HOME_FOR_KIND` in `@gwc/contracts/capabilities` already maps every member
 * session here on sign-in.
 *
 * One tab today: the marketplace, which is what this feature adds. Unlike the
 * Admin Panel's sidebar, these items carry no `module` — the module/flag
 * matrix is a STAFF concept (`admin_permissions`), and a member reaching this
 * shell has already proven the one thing that matters here: they are signed
 * in as a member at all.
 */
export function MemberLayout() {
  const t = useTranslations()
  // No `module` on this item — Sidebar.tsx's label fallback is `t.modules[…]`,
  // which only exists for staff modules, so the label is named explicitly.
  const items: readonly SidebarItem[] = [
    { to: '/konsole/mitglied', end: true, label: t.memberMarketplace.tabLabel },
  ]
  return <ConsoleShell title={t.portals.member} items={items} signOutPath="/auth/sign-out" />
}

export default MemberLayout
