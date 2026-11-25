import { useCallback } from 'react'
import { get } from '../../lib/api'
import { useTranslations } from '../../i18n/index'
import RequireGrant from '../RequireGrant'
import ReportView from '../../offers/ReportView'
import type { ReportCategory, ReportMerchant } from '../../offers/ReportView'

/**
 * The platform redemption report (feature 035), for staff holding
 * `merchant_offers.read` — a superadmin does by the usual rule. It adds the
 * merchant filter, which the server honours only on this route.
 */
export function RedemptionReport() {
  return (
    <RequireGrant module="merchant_offers" flag="read">
      <Report />
    </RequireGrant>
  )
}

function Report() {
  const t = useTranslations()
  const loadCategories = useCallback(
    async () => ((await get('/admin/offer-categories')) as { items: ReportCategory[] }).items, [],
  )
  const loadMerchants = useCallback(async () => {
    const stores = ((await get('/admin/stores')) as { items: { organisationId: string; displayName: string | null; slug: string }[] }).items
    return stores.map((s): ReportMerchant => ({ organisationId: s.organisationId, displayName: s.displayName, slug: s.slug }))
  }, [])
  return <ReportView path="/admin/reports/redemptions" subtitle={t.redemptionReport.platformIntro} loadCategories={loadCategories} loadMerchants={loadMerchants} />
}

export default RedemptionReport
