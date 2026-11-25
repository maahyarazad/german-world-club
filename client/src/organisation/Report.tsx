import { useCallback } from 'react'
import { get } from '../lib/api'
import { useTranslations } from '../i18n/index'
import ReportView from '../offers/ReportView'
import type { ReportCategory } from '../offers/ReportView'

/**
 * A merchant's redemption report (feature 035): their own organisation's
 * redemptions only. The scope is the server's, from the session; nothing here
 * can ask for another merchant's.
 */
export function MerchantReport() {
  const t = useTranslations()
  // Stable across renders, so the view does not reload on every keystroke.
  const loadCategories = useCallback(
    async () => ((await get('/merchant/categories')) as { items: ReportCategory[] }).items, [],
  )
  return <ReportView path="/merchant/reports/redemptions" subtitle={t.redemptionReport.merchantIntro} loadCategories={loadCategories} />
}

export default MerchantReport
