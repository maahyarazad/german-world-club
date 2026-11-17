import { useEffect, useState } from 'react'
import { useCapabilities } from '../lib/capabilities'
import { adminApi, ApiError } from '../lib/api'
import type { DashboardFiguresResponse } from '@gwc/contracts/admin'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import KpiTile, { KpiRow } from '../components/ui/KpiTile'
import Callout from '../components/ui/Callout'
import { formatNumber } from '../lib/format'
import type { Module, Flag } from '@gwc/contracts/permissions'
import { FLAGS } from '@gwc/contracts/permissions'
import { isAvailable } from '@gwc/contracts/capabilities'
import { useLocale, useTranslations } from '../i18n/index'

/**
 * The Admin Panel landing page.
 *
 * A superadmin sees the club in numbers (feature 028); every other staff member
 * sees what their own account holds, because the club-wide figures are refused
 * to them by the server. Either way it reports only what the server can back: a
 * figure that could not be computed reads "Unavailable", never a zero that
 * would be a lie told in a larger typeface.
 */
export function AdminDashboard() {
  const { snapshot } = useCapabilities()
  return snapshot?.isSuperadmin ? <SuperadminDashboard /> : <StaffDashboard />
}

function SuperadminDashboard() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [data, setData] = useState<DashboardFiguresResponse | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    adminApi.figures().then(setData).catch((error) => {
      console.error('AdminDashboard.figures', error instanceof ApiError ? error.problem : error)
      setFailed(true)
    })
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Admin Panel" subtitle={t.adminDashboard.subtitle} />

      {failed && <Callout variant="gold" title={t.adminDashboard.figuresFailed}>{null}</Callout>}

      {data && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.figures.map(({ key, value }) => (
            <KpiTile
              key={key}
              value={value === null ? t.adminDashboard.figureUnavailable : formatNumber(value, locale)}
              caption={t.adminDashboard.figures[key]}
            />
          ))}
        </div>
      )}

      <Callout variant="gold" title={t.adminDashboard.governanceTitle}>
        {t.adminDashboard.governanceBody}
      </Callout>
    </div>
  )
}

function StaffDashboard() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()
  // Object.entries widens the key to string; the snapshot's keys are Modules.
  const modules = Object.entries(snapshot?.modules ?? {}) as [Module, Partial<Record<Flag, boolean>>][]
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
