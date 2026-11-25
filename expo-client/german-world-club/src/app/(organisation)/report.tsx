import { useEffect, useState } from 'react';

import type { RedemptionReport } from '@gwc/contracts/redemptions';

import { ApiError } from '@/api/client';
import { merchantApi } from '@/api/endpoints';
import { ThemedText } from '@/components/themed-text';
import { Card, FormScreen, Loading } from '@/components/ui';
import { useTranslations } from '@/i18n';

/**
 * A merchant's redemption report on the phone (feature 035): the totals and the
 * latest redemptions of their own organisation. The full report, with filters
 * and paging, is on the web; this is what fits a glance. The scope is the
 * server's, from the session — nothing here can ask for another merchant's.
 */
export default function Report() {
  const { t, formatMoney, formatDate } = useTranslations();
  const [report, setReport] = useState<RedemptionReport | null>(null);

  useEffect(() => {
    merchantApi.report().then(setReport, (e) => console.error('Report.load', e instanceof ApiError ? e.problem : e));
  }, []);

  if (!report) return <Loading />;
  return (
    <FormScreen title={t.merchant.report.title} subtitle={t.merchant.report.intro}>
      <Card>
        <ThemedText type="small" themeColor="textSecondary">{t.merchant.report.total}</ThemedText>
        <ThemedText type="subtitle">{report.totals.count}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{t.merchant.report.saving}</ThemedText>
        <ThemedText type="smallBold">{report.totals.estimatedSavingCents === null ? '—' : formatMoney(report.totals.estimatedSavingCents, 'EUR')}</ThemedText>
      </Card>
      {report.totals.count === 0 ? <ThemedText themeColor="textSecondary">{t.merchant.report.empty}</ThemedText> : (
        <>
          <ThemedText type="smallBold">{t.merchant.report.byOffer}</ThemedText>
          {report.byOffer.map((o) => (
            <Card key={o.offerId}>
              <ThemedText>{o.title}</ThemedText>
              <ThemedText type="smallBold">{o.count}</ThemedText>
            </Card>
          ))}
          <ThemedText type="smallBold">{t.merchant.report.recent}</ThemedText>
          {report.rows.slice(0, 20).map((r) => (
            <Card key={r.id}>
              <ThemedText>{r.offerTitle}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {r.redeemerName} · {t.merchant.report.kinds[r.redeemerKind]} · {formatDate(r.redeemedAt, true)}
              </ThemedText>
              <ThemedText type="smallBold">{r.reference}</ThemedText>
            </Card>
          ))}
        </>
      )}
    </FormScreen>
  );
}
