import type { SidebarItem } from '../Sidebar'
import ConsoleShell from '../ConsoleShell'
import { useTranslations } from '../../i18n/index'

/**
 * The Admin Panel's sidebar, in the order of the page-10 mockup.
 *
 * Every entry names the module that gates it, so the sidebar is a projection of
 * the permission matrix rather than a second list somebody has to keep in step
 * with it. An entry whose module has no server route yet renders as "noch nicht
 * verfügbar" — see Sidebar.jsx.
 */
export const ADMIN_ITEMS: readonly SidebarItem[] = [
  { to: '/konsole/admin', label: 'Dashboard', end: true },
  { to: '/konsole/admin/mitglieder', module: 'members' },
  { to: '/konsole/admin/angebote', module: 'marketplace_moderation' },
  { to: '/konsole/admin/threads', module: 'threads_moderation' },
  { to: '/konsole/admin/partner-inhalte', module: 'partners' },
  { to: '/konsole/admin/beschwerden', module: 'support_tickets' },
  { to: '/konsole/admin/events', module: 'events' },
  { to: '/konsole/admin/billing', module: 'membership_orders' },
  { to: '/konsole/admin/seo', module: 'seo' },
  { to: '/konsole/admin/push', module: 'mass_messages' },
  { to: '/konsole/admin/fehlerprotokoll', module: 'server_faults' },
  { to: '/konsole/admin/empfehlungen', module: 'referrals' },
  { to: '/konsole/admin/jobs', module: 'jobs' },
  { to: '/konsole/admin/rollen', module: 'admins' },
  { to: '/konsole/admin/einstellungen', module: 'settings' },
]

export function AdminLayout() {
  const t = useTranslations()
  // Every staff member's own Refer & earn page (feature 018). No module: it
  // needs no grant, the same way the server mounts it with `anyStaff` — and
  // it is labelled here because only module items take their label from
  // `t.modules`.
  const items: readonly SidebarItem[] = [
    ...ADMIN_ITEMS,
    { to: '/konsole/admin/empfehlen', label: t.referrals.tabLabel },
  ]
  return <ConsoleShell title={t.portals.staff} items={items} signOutPath="/auth/staff/sign-out" />
}

export default AdminLayout
