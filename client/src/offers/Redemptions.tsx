import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { Redemption } from '@gwc/contracts/redemptions'
import { ApiError } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { clubOffersApi, OFFERS_LIST_SEGMENT } from './api'
import type { OffersKind } from './api'

/**
 * What this account has redeemed (feature 035, FR-020): the offer, the merchant
 * and the reference to show at the store. Only the signed-in account's own; the
 * merchant-wide and platform-wide views are the reports.
 */
export function Redemptions({ kind }: { kind: OffersKind }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [api] = useState(() => clubOffersApi(kind))
  const [items, setItems] = useState<Redemption[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    void api.mine().then((r) => { setItems(r.items); setCursor(r.nextCursor) })
      .catch((err) => console.error('Redemptions.load', err instanceof ApiError ? err.problem : err))
  }, [api])

  const loadMore = async () => {
    if (!cursor) return
    setMore(true)
    try {
      const page = await api.mine(cursor)
      setItems((current) => [...(current ?? []), ...page.items])
      setCursor(page.nextCursor)
    } catch (err) {
      console.error('Redemptions.loadMore', err instanceof ApiError ? err.problem : err)
    } finally {
      setMore(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.clubOffers.myRedemptions} subtitle={t.clubOffers.myRedemptionsIntro}
        actions={<Link to={`../${OFFERS_LIST_SEGMENT[kind]}`} relative="path" className="text-[13px] text-navy">← {t.clubOffers.back}</Link>} />
      {items === null ? <PageLoader /> : items.length === 0 ? (
        <Card><p className="text-[14px] text-text-muted">{t.clubOffers.noRedemptions}</p></Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <h2 className="text-[16px] font-semibold text-text">{r.offerTitle}</h2>
                    {r.merchantName && <p className="text-[13px] text-text-muted">{r.merchantName}</p>}
                    <p className="text-[12px] text-text-muted">{t.clubOffers.redeemedOn.replace('{date}', formatDateTime(r.redeemedAt, locale))}</p>
                  </div>
                  <p className="text-[18px] font-semibold tracking-wide text-navy">{r.reference}</p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {cursor && <div><Button variant="secondary" loading={more} onClick={() => void loadMore()}>{t.clubOffers.loadMore}</Button></div>}
    </div>
  )
}

export default Redemptions
