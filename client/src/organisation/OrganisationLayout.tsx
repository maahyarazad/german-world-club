import ConsoleShell from '../console/ConsoleShell'
import type { SidebarItem } from '../console/Sidebar'
import { useTranslations } from '../i18n/index'

/**
 * The shell for the two organisation portals, at the paths `HOME_FOR_KIND`
 * already maps `merchant` and `partner` to.
 *
 * Without it a merchant who signed in successfully had nowhere to land: the
 * console had no route at `/konsole/merchant`, fell through to `Elsewhere`,
 * and — with no snapshot, because the only capability route was staff-only —
 * ended up on the member area showing "permissions could not be loaded".
 *
 * Sign-out goes to the kind's own route. `/auth/sign-out` is member-only and
 * `/auth/staff/sign-out` staff-only, so the shell's default would be refused
 * and leave the session alive on the server.
 */
export function OrganisationLayout({ kind }: { kind: 'merchant' | 'partner' }) {
  const t = useTranslations()
  const home = `/konsole/${kind}`
  const items: readonly SidebarItem[] = [
    { to: home, end: true, label: t.organisationPortal.home },
  ]
  return <ConsoleShell title={t.portals[kind]} items={items} signOutPath={`/auth/${kind}/sign-out`} />
}

export default OrganisationLayout
