import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import type { MerchantOffer } from '@gwc/contracts/offers'
import { ApiError } from '../lib/api'
import { formatDate } from '../lib/format'
import { useReveal } from '../lib/useReveal'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import StatusPill from '../components/ui/StatusPill'
import type { StatusTone } from '../components/ui/StatusPill'
import { FormMessage } from '../components/ui/Field'
import { merchantApi } from './api'

const TONE: Record<MerchantOffer['state'], StatusTone> = {
  draft: 'neutral', pending: 'pending', published: 'success', rejected: 'danger', withdrawn: 'neutral',
}

/**
 * A merchant's offers (feature 035): every one of their own, in any state, with
 * publish and withdraw. Publishing needs no approval and announces the offer to
 * members once.
 *
 * A refusal is logged to the console; the two that a person cannot proceed
 * without understanding — no public name yet, a switched-off store — are shown
 * in words, as are stale edits.
 */
export function OffersPage() {
  const t = useTranslations()
  const { locale } = useLocale()
  const [offers, setOffers] = useState<MerchantOffer[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  // A refusal here (publishing needs a public name and an active store) is shown at the top of a
  // list the merchant may have scrolled down: bring it into view (feature 041). `act` clears it
  // when a request starts, so the same refusal twice is still a change. Above the loader's return.
  const messageRef = useReveal<HTMLDivElement>(message)

  useEffect(() => {
    void merchantApi.offers().then((r) => setOffers(r.items)).catch((err) => {
      console.error('OffersPage.load', err instanceof ApiError ? err.problem : err)
    })
  }, [])

  const act = async (offer: MerchantOffer, action: 'publish' | 'withdraw') => {
    setBusyId(offer.id)
    setMessage(null)
    try {
      const next = await merchantApi[action](offer.id)
      setOffers((current) => current?.map((o) => (o.id === next.id ? next : o)) ?? null)
    } catch (err) {
      console.error('OffersPage.act', err instanceof ApiError ? err.problem : err)
      const type = err instanceof ApiError ? err.problem?.type ?? '' : ''
      if (type.includes('profile-incomplete')) setMessage(t.merchantOffers.refusals.profileIncomplete)
      else if (type.includes('store-inactive')) setMessage(t.merchantOffers.refusals.storeInactive)
    } finally {
      setBusyId(null)
    }
  }

  if (!offers) return <PageLoader />

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.merchantOffers.title}
        subtitle={t.merchantOffers.intro}
        actions={<Link to="neu" className="rounded-card bg-accent px-4 py-2 text-[13px] font-semibold text-ink">{t.merchantOffers.new}</Link>}
      />
      {message && <FormMessage ref={messageRef} tone="danger">{message}</FormMessage>}

      {offers.length === 0 ? (
        <Card><p className="text-[14px] text-text-muted">{t.merchantOffers.empty}</p></Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {offers.map((offer) => (
            <li key={offer.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2 className="text-[16px] font-semibold text-text">{offer.title}</h2>
                    <p className="text-[12px] text-text-muted">
                      {t.merchantOffers.kinds[offer.benefit.kind]} · {formatDate(offer.validFrom, locale)} – {formatDate(offer.validUntil, locale)}
                    </p>
                    <StatusPill tone={TONE[offer.state]}>{t.merchantOffers.states[offer.state]}</StatusPill>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link to={offer.id} className="rounded-card border border-hairline px-3 py-2 text-[13px] text-navy">{t.merchantOffers.edit}</Link>
                    {(offer.state === 'draft' || offer.state === 'withdrawn') && (
                      <Button loading={busyId === offer.id} onClick={() => void act(offer, 'publish')}>{t.merchantOffers.publish}</Button>
                    )}
                    {offer.state === 'published' && (
                      <Button variant="secondary" loading={busyId === offer.id} onClick={() => void act(offer, 'withdraw')}>
                        {t.merchantOffers.withdraw}
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default OffersPage
