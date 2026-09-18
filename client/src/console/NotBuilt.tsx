import { useLocation } from 'react-router'
import PageHeader from '../components/ui/PageHeader'
import Callout from '../components/ui/Callout'
import { useTranslations } from '../i18n/index'
import { MODULES } from '@gwc/contracts/permissions'
import type { Module } from '@gwc/contracts/permissions'

/**
 * A console route the sidebar offers but the client has no page for yet.
 *
 * This exists because the alternative was worse. Without it, a path like
 * `/konsole/admin/einstellungen` matched no route, fell through to the
 * top-level `*`, and redirected to the sign-in screen — which reads as being
 * signed out, on a session that is perfectly valid. Landing here instead keeps
 * the shell, the sidebar and the session, and says what is actually true.
 *
 * `available` is the server's answer about its own routes, so a module can be
 * granted and servable while the console has not been built for it. That gap
 * is expected during the build-out and is what this page reports.
 */
export function NotBuilt() {
  const t = useTranslations()
  const { pathname } = useLocation()

  // The last segment is the module's slug in every admin route; fall back to
  // the path itself so an unrecognised one still names what was asked for.
  const slug = pathname.split('/').filter(Boolean).at(-1) ?? ''
  const known = (MODULES as readonly string[]).includes(slug) ? (slug as Module) : null
  const title = known ? t.modules[known] : slug

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} />
      <Callout variant="neutral" title={t.console.notAvailable}>
        {t.console.notAvailableHint}
      </Callout>
    </div>
  )
}

export default NotBuilt
