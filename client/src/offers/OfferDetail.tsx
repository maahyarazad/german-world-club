import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import type { MemberOffer } from '@gwc/contracts/offers'
import type { Redemption } from '@gwc/contracts/redemptions'
import { ApiError } from '../lib/api'
import { formatDate, formatMoney } from '../lib/format'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Callout from '../components/ui/Callout'
import { FormMessage } from '../components/ui/Field'
import MediaGrid from '../member/threads/MediaGrid'
import { clubOffersApi } from './api'
import type { OffersKind } from './api'
import { benefitText } from './benefit'

/**
 * One merchant offer, and redeeming it (feature 035).
 *
 * The request id is made once and reused until the server has answered: a double
 * tap or a retry after a lost response carries the same one, and the server
 * answers a repeat with the original redemption — so this page can never turn a
 * retry into a second redemption. After an answer, good or refused, the next
 * attempt is a new request and gets a new id.
 *
 * A refusal the person cannot proceed without understanding (sold out, already
 * redeemed as often as allowed, no longer available) is shown in words; every
 * refusal is also logged to the console.
 */
export function OfferDetail({ kind }: { kind: OffersKind }) {
  const t = useTranslations()
  const { locale } = useLocale()
  const { id = '' } = useParams()
  const [api] = useState(() => clubOffersApi(kind))
  const [offer, setOffer] = useState<MemberOffer | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Redemption | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const requestId = useRef(crypto.randomUUID())
  const sending = useRef(false)

  useEffect(() => {
    void api.detail(id).then(setOffer).catch((err) => {
      console.error('OfferDetail.load', err instanceof ApiError ? err.problem : err)
      setOffer(null)
    })
  }, [api, id])

  const redeem = async () => {
    // A ref, not `busy`: two presses in one frame would both see `busy === false`.
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setRefusal(null)
    try {
      setDone(await api.redeem(id, requestId.current))
      requestId.current = crypto.randomUUID()
    } catch (err) {
      console.error('OfferDetail.redeem', err instanceof ApiError ? err.problem : err)
      if (err instanceof ApiError) {
        // The server answered, so the next attempt is a new request.
        requestId.current = crypto.randomUUID()
        const type = err.problem?.type ?? ''
        setRefusal(
          type.includes('sold-out') ? t.clubOffers.refusals.soldOut
            : type.includes('per-person-limit') ? t.clubOffers.refusals.perPersonLimit
              : type.includes('own-offer') ? t.clubOffers.refusals.ownOffer
                : err.status === 404 ? t.clubOffers.refusals.unavailable : null,
        )
      }
      // A network failure keeps the same request id, so pressing again is a retry.
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  if (offer === undefined) return <PageLoader />
  if (offer === null) {
    return (
      <div className="flex flex-col gap-4">
        <Callout variant="neutral" title={t.clubOffers.refusals.unavailable}>{null}</Callout>
        <Link to=".." relative="path" className="text-[13px] text-navy">← {t.clubOffers.back}</Link>
      </div>
    )
  }

  const name = locale === 'en' ? offer.category.nameEn : offer.category.nameDe
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={offer.title} subtitle={`${offer.merchant.displayName} · ${name}`}
        actions={<Link to=".." relative="path" className="text-[13px] text-navy">← {t.clubOffers.back}</Link>} />

      <MediaGrid media={offer.media} />

      <Card>
        <p className="mb-1 text-[18px] font-semibold text-navy">{benefitText(t, offer.benefit, offer.currency, locale)}</p>
        {offer.description && <p className="mb-3 text-[14px] text-text">{offer.description}</p>}
        {(offer.regularPriceCents !== null || offer.memberPriceCents !== null) && (
          <p className="mb-3 text-[14px] text-text">
            {offer.regularPriceCents !== null && <span className="mr-4 text-text-muted line-through" aria-label={t.clubOffers.regularPrice}>{formatMoney(offer.regularPriceCents, offer.currency, locale)}</span>}
            {offer.memberPriceCents !== null && <span className="font-semibold" aria-label={t.clubOffers.memberPrice}>{formatMoney(offer.memberPriceCents, offer.currency, locale)}</span>}
          </p>
        )}
        <p className="text-[12px] text-text-muted">{t.clubOffers.validUntil.replace('{date}', formatDate(offer.validUntil, locale))}</p>
        {offer.perPersonLimit !== null && <p className="text-[12px] text-text-muted">{t.clubOffers.perPerson.replace('{count}', String(offer.perPersonLimit))}</p>}
        {offer.conditions && (
          <div className="mt-3"><p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">{t.clubOffers.conditions}</p>
            <p className="text-[13px] text-text">{offer.conditions}</p></div>
        )}
      </Card>

      {refusal && <FormMessage tone="danger">{refusal}</FormMessage>}

      {done ? (
        <Callout variant="info" title={t.clubOffers.redeemed}>
          <p className="text-[12px] uppercase tracking-[0.06em] text-text-muted">{t.clubOffers.reference}</p>
          <p className="text-[22px] font-semibold tracking-wide text-text">{done.reference}</p>
          <p className="mt-1 text-[13px] text-text-muted">{t.clubOffers.showAtStore}</p>
        </Callout>
      ) : (
        <div><Button loading={busy} onClick={() => void redeem()}>{t.clubOffers.redeem}</Button></div>
      )}
    </div>
  )
}

export default OfferDetail
