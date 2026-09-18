import { Outlet } from 'react-router'
import Sidebar from './Sidebar'
import EmptyState from './EmptyState'
import { useCapabilities } from '../lib/capabilities'
import { post } from '../lib/api'
import Button from '../components/ui/Button'
import { useTranslations } from '../i18n/index'
import LanguageSwitch from '../components/ui/LanguageSwitch'

/**
 * The portal frame: dark sidebar, content on the page ground.
 *
 * One shell for all four portals. The mockups draw the Admin Panel, the
 * Merchant Portal and the Partner Portal with an identical grammar — sidebar,
 * KPI row, cards — and differ only in what fills it. Building three shells
 * would have produced three sets of drift.
 */
export function ConsoleShell({ title, items, signOutPath = '/auth/sign-out' }) {
  const t = useTranslations()
  const { snapshot, clear } = useCapabilities()

  const signOut = async () => {
    try {
      await post(signOutPath)
    } finally {
      // Clear locally whatever the server said. A sign-out that failed to
      // reach the server must still not leave a capability snapshot sitting in
      // memory on a shared staff workstation.
      clear()
    }
  }

  const hasAnything =
    snapshot?.kind !== 'staff' || Object.keys(snapshot?.modules ?? {}).length > 0

  return (
    <div className="min-h-svh bg-ground font-sans text-text">
      <div className="mx-auto flex max-w-[1600px] flex-col lg:flex-row">
        <aside className="lg:sticky lg:top-0 lg:h-svh lg:w-56 lg:shrink-0">
          <Sidebar items={items} title={title} />
        </aside>

        <div className="min-w-0 flex-1">
          <header className="flex items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {/* Explicit dimensions, and a derivative rather than the
                  original — Principle VI, FR-013. */}
              <img
                src="/gwc-logo.png"
                alt={t.brand.logoAlt}
                width="844"
                height="578"
                className="h-8 w-auto"
              />
              <span className="truncate text-[13px] text-text-muted">
                {snapshot?.displayName ?? ''}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <LanguageSwitch />
              <Button variant="secondary" onClick={signOut}>
                {t.console.signOut}
              </Button>
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6">
            {hasAnything ? (
              <Outlet />
            ) : (
              <EmptyState title={t.console.noGrantsTitle}>{t.console.noGrantsBody}</EmptyState>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}

export default ConsoleShell
