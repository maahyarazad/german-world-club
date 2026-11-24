import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { OfferListItem, BrowseCategory } from '@gwc/contracts/offers'
import { ApiError } from '../lib/api'
import { formatDate } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import { smallestUrl } from '../member/threads/MediaGrid'
import { clubOffersApi } from './api'
import type { OffersKind } from './api'
import { benefitText } from './benefit'

/**
 * Merchant offers, by category (feature 035) — the same page for every kind of
 * account, mounted under each portal.
 *
 * Shows what the server says is visible now and decides nothing: a sold-out
 * offer is shown as sold out, and one in a store staff switched off simply is
 * not in the list. Lists carry a thumbnail, never the original.
 */
export function Offers({ kind }: { kind: OffersKind }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [api] = useState(() => clubOffersApi(kind))
  const [categories, setCategories] = useState<BrowseCategory[] | null>(null)
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [items, setItems] = useState<OfferListItem[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [more, setMore] = useState(false)

  useEffect(() => {
    void api.categories().then((r) => setCategories(r.items))
      .catch((err) => console.error('Offers.categories', err instanceof ApiError ? err.problem : err))
  }, [api])

  const load = useCallback((id: string | undefined) => {
    setItems(null)
    void api.list(id).then((r) => { setItems(r.items); setCursor(r.nextCursor) })
      .catch((err) => console.error('Offers.load', err instanceof ApiError ? err.problem : err))
  }, [api])
  useEffect(() => load(categoryId), [load, categoryId])

  const loadMore = async () => {
    if (!cursor) return
    setMore(true)
    try {
      const page = await api.list(categoryId, cursor)
      setItems((current) => [...(current ?? []), ...page.items])
      setCursor(page.nextCursor)
    } catch (err) {
      console.error('Offers.loadMore', err instanceof ApiError ? err.problem : err)
    } finally {
      setMore(false)
    }
  }

  const name = (c: BrowseCategory) => (locale === 'en' ? c.nameEn : c.nameDe)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.clubOffers.title}
        subtitle={t.clubOffers.intro}
        actions={<Link to="../einloesungen" relative="path" className="text-[13px] text-navy">{t.clubOffers.myRedemptions}</Link>}
      />

      {categories && (
        <ul className="flex flex-wrap gap-2" aria-label={t.clubOffers.title}>
          {[{ id: undefined, label: t.clubOffers.allCategories }, ...categories.map((c) => ({ id: c.id as string | undefined, label: `${name(c)} (${c.offerCount})` }))].map((c) => (
            <li key={c.id ?? 'all'}>
              <Button variant={categoryId === c.id ? 'primary' : 'secondary'} aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.label}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {/* The page has not received its data: the loader, never an empty message. */}
      {items === null ? <PageLoader /> : items.length === 0 ? (
        <Card><p className="text-[14px] text-text-muted">{t.clubOffers.empty}</p></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((offer) => (
            <li key={offer.id}>
              <Link to={offer.id} className="block h-full">
                <Card className="flex h-full flex-col gap-3 hover:border-navy">
                  {offer.thumbnail ? (
                    <img
                      src={smallestUrl(offer.thumbnail, 400) || offer.thumbnail.posterUrl || ''}
                      width={offer.thumbnail.width}
                      height={offer.thumbnail.height}
                      alt={offer.thumbnail.alt}
                      loading="lazy"
                      className="aspect-[4/3] w-full rounded-card object-cover"
                    />
                  ) : null}
                  <div className="flex flex-col gap-1">
                    <h2 className="text-[16px] font-semibold leading-snug text-text">{offer.title}</h2>
                    <p className="text-[13px] text-text-muted">{offer.merchant.displayName}</p>
                    <p className="text-[14px] font-medium text-navy">{benefitText(t, offer.benefit, offer.currency, locale)}</p>
                    <p className="text-[12px] text-text-muted">{t.clubOffers.validUntil.replace('{date}', formatDate(offer.validUntil, locale))}</p>
                  </div>
                  {offer.soldOut && <StatusPill tone="neutral">{t.clubOffers.soldOut}</StatusPill>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {cursor && <div><Button variant="secondary" loading={more} onClick={() => void loadMore()}>{t.clubOffers.loadMore}</Button></div>}
    </div>
  )
}

export default Offers
