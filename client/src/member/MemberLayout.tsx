import { useCallback, useEffect, useState } from 'react'
import ConsoleShell from '../console/ConsoleShell'
import type { SidebarItem } from '../console/Sidebar'
import { get, ApiError } from '../lib/api'
import { formatNumber } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * The member area's tab bar, at `/konsole/mitglied` — `HOME_FOR_KIND` in
 * `@gwc/contracts/capabilities` already maps every member session here.
 *
 * Marketplace (008), Threads, Activity and Profile (010). Unlike the Admin
 * Panel's sidebar, these items carry no `module` — the module/flag matrix is a
 * STAFF concept (`admin_permissions`), and a member reaching this shell has
 * already proven the one thing that matters here: they are signed in as a
 * member at all.
 *
 * The Activity badge is polled — on focus and every minute while the tab is
 * visible — because delivery is on read in 010: there is no push and no
 * socket to be told by (research R8).
 */
export const UNREAD_POLL_MS = 60_000

function useUnread() {
  const [unread, setUnread] = useState(0)
  const refresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    void get('/threads/activity/unread').then((b) => setUnread((b as { unread: number }).unread))
      .catch((err) => console.error('useUnread.refresh', err instanceof ApiError ? err.problem : err))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, UNREAD_POLL_MS)
    window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [refresh])
  return { unread, refresh, clear: () => setUnread(0) }
}

export function MemberLayout() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { unread } = useUnread()
  // No `module` on these items — Sidebar.tsx's label fallback is `t.modules[…]`,
  // which only exists for staff modules, so each label is named explicitly.
  const items: readonly SidebarItem[] = [
    { to: '/konsole/mitglied/threads', label: t.memberThreads.tabLabel },
    {
      to: '/konsole/mitglied/aktivitaet',
      label: (
        <span className="flex items-center gap-2">
          {t.memberActivity.tabLabel}
          {unread > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-ink">{formatNumber(unread, locale)}</span>
          )}
        </span>
      ),
    },
    { to: '/konsole/mitglied', end: true, label: t.memberMarketplace.tabLabel },
    { to: '/konsole/mitglied/profil', label: t.memberProfile.tabLabel },
  ]
  return <ConsoleShell title={t.portals.member} items={items} signOutPath="/auth/sign-out" />
}

export default MemberLayout
