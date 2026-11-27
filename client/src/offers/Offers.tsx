import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { OfferListItem, BrowseCategory } from '@gwc/contracts/offers'
import { SEARCH_MIN_LENGTH } from '@gwc/contracts/search'
import { ApiError } from '../lib/api'
import { formatDate } from '../lib/format'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import SearchField from '../components/ui/SearchField'
import { OfferPicture } from './OfferPicture'
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
 *
 * The search box (feature 042) narrows the list on the server, over every offer the
 * person may see and not only the ones loaded. It waits for a pause in typing, sends
 * nothing for fewer than `SEARCH_MIN_LENGTH` characters, and keeps the chosen category.
 * Each answer is stored with the category and search it answers, and shown only while that
 * is still what is asked for: so the loader shows until the right answer arrives, and an
 * old answer that lands late can never replace a newer one.
 */
export function Offers({ kind }: { kind: OffersKind }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [api] = useState(() => clubOffersApi(kind))
  const [categories, setCategories] = useState<BrowseCategory[] | null>(null)
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined)
  const [text, setText] = useState('')
  const typed = text.trim()
  const q = useDebouncedValue(typed.length >= SEARCH_MIN_LENGTH ? typed : '')
  const key = `${categoryId ?? ''}|${q}`
  const [result, setResult] = useState<{ key: string; items: OfferListItem[]; cursor: string | null } | null>(null)
  const [more, setMore] = useState(false)
  // What the page shows: the answer to what is asked for now, or nothing yet (the loader).
  const items = result?.key === key ? result.items : null
  const cursor = result?.key === key ? result.cursor : null

  useEffect(() => {
    void api.categories().then((r) => setCategories(r.items))
      .catch((err) => console.error('Offers.categories', err instanceof ApiError ? err.problem : err))
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    api.list(categoryId, null, q, controller.signal)
      .then((r) => { if (!controller.signal.aborted) setResult({ key, items: r.items, cursor: r.nextCursor }) })
      .catch((err) => { if (!controller.signal.aborted) console.error('Offers.load', err instanceof ApiError ? err.problem : err) })
    return () => controller.abort()
  }, [api, categoryId, q, key])

  const loadMore = async () => {
    if (!cursor) return
    setMore(true)
    try {
      const page = await api.list(categoryId, cursor, q)
      setResult((current) => (current?.key === key
        ? { key, items: [...current.items, ...page.items], cursor: page.nextCursor }
        : current))
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

      <SearchField
        value={text}
        onChange={setText}
        label={t.clubOffers.search.label}
        placeholder={t.clubOffers.search.placeholder}
        clearLabel={t.clubOffers.search.clear}
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
        <Card><p className="text-[14px] text-text-muted">{q ? t.clubOffers.search.noResults : t.clubOffers.empty}</p></Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((offer) => (
            <li key={offer.id}>
              <Link to={offer.id} className="block h-full">
                <Card className="flex h-full flex-col gap-3 hover:border-navy">
                  {/* 16:9, and the club's fallback when the offer has no usable media (feature 042). */}
                  <OfferPicture item={offer.thumbnail} maxWidth={400} />
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
