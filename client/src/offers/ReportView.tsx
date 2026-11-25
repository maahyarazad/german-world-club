import { useCallback, useEffect, useState } from 'react'
import type { RedemptionReport } from '@gwc/contracts/redemptions'
import { ApiError, get } from '../lib/api'
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { KpiRow, KpiTile } from '../components/ui/KpiTile'
import Field from '../components/ui/Field'

/**
 * The redemption report (feature 035), one view for a merchant's own and for the
 * whole platform: the totals over the filtered set, the same by offer and by
 * day, and the rows, paged.
 *
 * It shows what the server computed and decides nothing — in particular the
 * scope. The merchant's page and the staff page call different routes; the
 * merchant filter exists only where the server honours it.
 */
export type ReportCategory = { id: string; nameDe: string; nameEn: string }
export type ReportMerchant = { organisationId: string; displayName: string | null; slug: string }

type Filters = { categoryId: string; organisationId: string; from: string; to: string }
const NONE: Filters = { categoryId: '', organisationId: '', from: '', to: '' }

function query(filters: Filters, cursor?: string | null) {
  const params = new URLSearchParams()
  if (filters.categoryId) params.set('categoryId', filters.categoryId)
  if (filters.organisationId) params.set('organisationId', filters.organisationId)
  // The date inputs are days; the server takes instants. From is the start of that day, to the start of the next.
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00:00`).toISOString())
  if (filters.to) params.set('to', new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86_400_000).toISOString())
  if (cursor) params.set('cursor', cursor)
  const text = params.toString()
  return text ? `?${text}` : ''
}

export function ReportView({ path, subtitle, loadCategories, loadMerchants }: {
  path: string
  subtitle: string
  loadCategories: () => Promise<ReportCategory[]>
  /** Present only on the platform report. */
  loadMerchants?: () => Promise<ReportMerchant[]>
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [filters, setFilters] = useState<Filters>(NONE)
  const [report, setReport] = useState<RedemptionReport | null>(null)
  const [categories, setCategories] = useState<ReportCategory[]>([])
  const [merchants, setMerchants] = useState<ReportMerchant[]>([])
  const [more, setMore] = useState(false)

  useEffect(() => {
    void loadCategories().then(setCategories).catch((err) => console.error('ReportView.categories', err instanceof ApiError ? err.problem : err))
    if (loadMerchants) void loadMerchants().then(setMerchants).catch((err) => console.error('ReportView.merchants', err instanceof ApiError ? err.problem : err))
  }, [loadCategories, loadMerchants])

  const load = useCallback((f: Filters) => {
    setReport(null)
    void (get(`${path}${query(f)}`) as Promise<RedemptionReport>).then(setReport)
      .catch((err) => console.error('ReportView.load', err instanceof ApiError ? err.problem : err))
  }, [path])
  useEffect(() => load(filters), [load, filters])

  const loadMore = async () => {
    if (!report?.nextCursor) return
    setMore(true)
    try {
      const page = (await get(`${path}${query(filters, report.nextCursor)}`)) as RedemptionReport
      setReport({ ...report, rows: [...report.rows, ...page.rows], nextCursor: page.nextCursor })
    } catch (err) {
      console.error('ReportView.loadMore', err instanceof ApiError ? err.problem : err)
    } finally {
      setMore(false)
    }
  }

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }))
  const select = 'rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] text-text'
  const catName = (id: string) => { const c = categories.find((x) => x.id === id); return c ? (locale === 'en' ? c.nameEn : c.nameDe) : '' }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.redemptionReport.title} subtitle={subtitle} />

      <Card title={t.redemptionReport.filters}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.redemptionReport.category}
            <select value={filters.categoryId} onChange={(e) => set({ categoryId: e.target.value })} className={select}>
              <option value="">{t.redemptionReport.anyCategory}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{locale === 'en' ? c.nameEn : c.nameDe}</option>)}
            </select>
          </label>
          {loadMerchants && (
            <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t.redemptionReport.merchant}
              <select value={filters.organisationId} onChange={(e) => set({ organisationId: e.target.value })} className={select}>
                <option value="">{t.redemptionReport.anyMerchant}</option>
                {merchants.map((m) => <option key={m.organisationId} value={m.organisationId}>{m.displayName ?? m.slug}</option>)}
              </select>
            </label>
          )}
          <Field label={t.redemptionReport.from} type="date" value={filters.from} onChange={(e) => set({ from: e.target.value })} />
          <Field label={t.redemptionReport.to} type="date" value={filters.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      </Card>

      {report === null ? <PageLoader /> : (
        <>
          <KpiRow>
            <KpiTile value={formatNumber(report.totals.count, locale)} caption={t.redemptionReport.totalRedemptions} />
            <KpiTile
              value={report.totals.estimatedSavingCents === null ? t.redemptionReport.noSaving : formatMoney(report.totals.estimatedSavingCents, 'EUR', locale)}
              caption={t.redemptionReport.estimatedSaving}
            />
          </KpiRow>

          {report.totals.count === 0 ? (
            <Card><p className="text-[14px] text-text-muted">{t.redemptionReport.empty}</p></Card>
          ) : (
            <>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title={t.redemptionReport.byOffer}>
                  <table className="w-full text-left text-[13px]">
                    <tbody>
                      {report.byOffer.map((o) => (
                        <tr key={o.offerId} className="border-t border-hairline first:border-0">
                          <td className="py-2 pr-3">{o.title}<span className="block text-[11px] text-text-muted">{catName(o.categoryId)}</span></td>
                          <td className="py-2 text-right font-semibold">{formatNumber(o.count, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card title={t.redemptionReport.byDay}>
                  <table className="w-full text-left text-[13px]">
                    <tbody>
                      {report.byDay.map((d) => (
                        <tr key={d.day} className="border-t border-hairline first:border-0">
                          <td className="py-2 pr-3">{formatDate(d.day, locale)}</td>
                          <td className="py-2 text-right font-semibold">{formatNumber(d.count, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>

              <Card title={t.redemptionReport.rows}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[13px]">
                    <thead className="text-[11px] uppercase tracking-[0.06em] text-text-muted">
                      <tr>
                        <th className="py-2 pr-3 font-semibold">{t.redemptionReport.when}</th>
                        <th className="py-2 pr-3 font-semibold">{t.redemptionReport.offer}</th>
                        <th className="py-2 pr-3 font-semibold">{t.redemptionReport.redeemer}</th>
                        <th className="py-2 font-semibold">{t.redemptionReport.reference}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.rows.map((r) => (
                        <tr key={r.id} className="border-t border-hairline">
                          <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.redeemedAt, locale)}</td>
                          <td className="py-2 pr-3">{r.offerTitle}<span className="block text-[11px] text-text-muted">{catName(r.categoryId)}</span></td>
                          <td className="py-2 pr-3">{r.redeemerName}<span className="block text-[11px] text-text-muted">{t.redemptionReport.kinds[r.redeemerKind]}</span></td>
                          <td className="py-2 font-mono">{r.reference}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {report.nextCursor && <div className="mt-4"><Button variant="secondary" loading={more} onClick={() => void loadMore()}>{t.redemptionReport.loadMore}</Button></div>}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default ReportView
