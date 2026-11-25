import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { RedemptionReport } from '@gwc/contracts/redemptions'
import { ApiError, get } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import Card from '../components/ui/Card'

/**
 * The latest few redemptions on a dashboard (feature 035, FR-020 and US3): a
 * merchant's own on their home page, the platform's on the admin's. A glance,
 * not the report — the full one, with filters and totals, is one link away.
 *
 * Reads the same report route the full page does, so what a dashboard shows can
 * never disagree with the report it links to. A failure is logged and the card
 * is simply absent: a dashboard does not need to say that one of its panels did
 * not load.
 */
export function RecentRedemptions({ path, reportTo, limit = 5 }: { path: string; reportTo: string; limit?: number }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [rows, setRows] = useState<RedemptionReport['rows'] | null>(null)

  useEffect(() => {
    void (get(path) as Promise<RedemptionReport | null>)
      .then((report) => setRows(report?.rows?.slice(0, limit) ?? []))
      .catch((err) => { console.error('RecentRedemptions.load', err instanceof ApiError ? err.problem : err) })
  }, [path, limit])

  if (!rows || rows.length === 0) return null
  return (
    <Card title={t.redemptionReport.recent} actions={<Link to={reportTo} className="text-[13px] text-navy">{t.redemptionReport.viewAll}</Link>}>
      <ul className="flex flex-col divide-y divide-hairline">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
            <span className="min-w-0">
              <span className="font-medium text-text">{r.offerTitle}</span>
              <span className="block text-[11px] text-text-muted">{r.redeemerName} · {formatDateTime(r.redeemedAt, locale)}</span>
            </span>
            <span className="font-mono text-[12px] text-text-muted">{r.reference}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default RecentRedemptions
