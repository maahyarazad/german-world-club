import { useCapabilities } from '../lib/capabilities.jsx'
import PageHeader from '../components/ui/PageHeader.jsx'
import Card from '../components/ui/Card.jsx'
import KpiTile, { KpiRow } from '../components/ui/KpiTile.jsx'
import Callout from '../components/ui/Callout.jsx'
import { formatNumber } from '../lib/format.js'
import { FLAGS } from '@gwc/contracts/permissions'
import { isAvailable } from '@gwc/contracts/capabilities'
import { useLocale, useTranslations } from '../i18n/index.jsx'

/**
 * The Admin Panel landing page.
 *
 * It reports what this account actually holds rather than the queue counts of
 * the page-10 mockup, because those queues have no server endpoint yet and a
 * dashboard showing four zeroes would be a lie told in a larger typeface. The
 * counts arrive with the modules that produce them.
 */
export function AdminDashboard() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  const modules = Object.entries(snapshot?.modules ?? {})
  const ready = modules.filter(([module]) => isAvailable(snapshot, module))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin Panel"
        subtitle={t.adminDashboard.subtitle}
      />

      <KpiRow>
        <KpiTile value={formatNumber(modules.length, locale)} caption={t.adminDashboard.grantedAreas} />
        <KpiTile value={formatNumber(ready.length, locale)} caption={t.adminDashboard.usableAreas} />
        <KpiTile value={formatNumber(modules.length - ready.length, locale)} caption={t.adminDashboard.pendingAreas} />
        <KpiTile
          value={snapshot?.isSuperadmin ? t.adminDashboard.yes : t.adminDashboard.no}
          caption={t.adminDashboard.superadmin}
        />
      </KpiRow>

      <Card title={t.adminDashboard.yourAreas}>
        <ul className="flex flex-col gap-2">
          {modules.map(([module, grant]) => (
            <li
              key={module}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline-2 pb-2 last:border-b-0"
            >
              <span className="text-[13px] font-medium text-text">{t.modules[module] ?? module}</span>
              <span className="text-[11px] text-text-muted">
                {FLAGS.filter((flag) => grant[flag]).map((flag) => t.flags[flag]).join(' · ')}
                {!isAvailable(snapshot, module) && ` — ${t.console.notAvailable}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Callout variant="gold" title={t.adminDashboard.governanceTitle}>
        {t.adminDashboard.governanceBody}
      </Callout>
    </div>
  )
}

export default AdminDashboard
