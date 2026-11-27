import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { MAX_OFFER_MEDIA, NEW_OFFER_KINDS } from '@gwc/contracts/offers'
import type { MerchantOffer, OfferCategory, CreateOfferRequest } from '@gwc/contracts/offers'
import type { MediaItem } from '@gwc/contracts/media'
import { ApiError } from '../lib/api'
import { fill } from '../lib/format'
import { useReveal } from '../lib/useReveal'
import { checkMerchantFile, MERCHANT_MEDIA_TYPES } from '../lib/media-limits'
import type { FileCheck } from '../lib/media-limits'
import { useMediaUpload } from '../lib/use-media-upload'
import { useLocale, useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Field, { FormMessage } from '../components/ui/Field'
import UploadProgress from '../components/ui/UploadProgress'
import { OfferPicture } from '../offers/OfferPicture'
import { merchantApi } from './api'

type Form = {
  title: string; description: string; categoryId: string; benefitKind: (typeof NEW_OFFER_KINDS)[number] | string
  benefitValue: string; regularPrice: string; memberPrice: string
  validFrom: string; validUntil: string; conditions: string; remaining: string; perPerson: string
}

const EMPTY: Form = {
  title: '', description: '', categoryId: '', benefitKind: 'percentage', benefitValue: '', regularPrice: '', memberPrice: '',
  validFrom: '', validUntil: '', conditions: '', remaining: '', perPerson: '1',
}

/** `datetime-local` wants local time without a zone; the server wants an instant. */
const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const toIso = (local: string) => new Date(local).toISOString()
const intOrNull = (value: string) => (value.trim() === '' ? null : Math.round(Number(value)))
const numberOrNull = (value: string) => (value.trim() === '' ? null : Number(value))

const fromOffer = (o: MerchantOffer): Form => ({
  title: o.title, description: o.description ?? '', categoryId: o.categoryId, benefitKind: o.benefit.kind,
  benefitValue: o.benefit.value === null ? '' : String(o.benefit.value),
  regularPrice: o.regularPriceCents === null ? '' : String(o.regularPriceCents),
  memberPrice: o.memberPriceCents === null ? '' : String(o.memberPriceCents),
  validFrom: toLocalInput(o.validFrom), validUntil: toLocalInput(o.validUntil), conditions: o.conditions ?? '',
  remaining: o.remaining === null ? '' : String(o.remaining), perPerson: o.perPersonLimit === null ? '' : String(o.perPersonLimit),
})

/**
 * Creating or editing one offer (feature 035): its type, price or value, window,
 * limits and category, and — once it exists — its images and videos, at most ten.
 *
 * The category list comes from the server and nothing here knows which ones
 * exist. Prices are entered in cents, as the server stores them; a freebie or
 * buy-one-get-one needs neither a price nor a value.
 */
export function OfferEditor() {
  const t = useTranslations()
  const { locale } = useLocale()
  const navigate = useNavigate()
  const { id } = useParams()
  const creating = !id || id === 'neu'

  const [offer, setOffer] = useState<MerchantOffer | null>(null)
  const [categories, setCategories] = useState<OfferCategory[] | null>(null)
  const [form, setForm] = useState<Form>(EMPTY)
  const [loading, setLoading] = useState(!creating)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  // A save is pressed far below this message: bring it into view (feature 041). Creating an
  // offer navigates away and sets none. Above the loader's early return, like every hook.
  const messageRef = useReveal<HTMLDivElement>(message)
  const upload = useMediaUpload('merchant')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void merchantApi.categories().then((r) => setCategories(r.items)).catch((err) => {
      console.error('OfferEditor.categories', err instanceof ApiError ? err.problem : err)
    })
  }, [])

  useEffect(() => {
    if (creating) return
    void merchantApi.offers().then((r) => {
      const found = r.items.find((o) => o.id === id)
      if (found) { setOffer(found); setForm(fromOffer(found)) }
    }).catch((err) => {
      console.error('OfferEditor.load', err instanceof ApiError ? err.problem : err)
    }).finally(() => setLoading(false))
  }, [creating, id])

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }))
  const noValue = form.benefitKind === 'freebie' || form.benefitKind === 'bogo'

  const body = (): CreateOfferRequest => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    categoryId: form.categoryId || null,
    benefitKind: form.benefitKind as CreateOfferRequest['benefitKind'],
    benefitValue: noValue ? null : numberOrNull(form.benefitValue),
    regularPriceCents: noValue ? null : intOrNull(form.regularPrice),
    memberPriceCents: noValue ? null : intOrNull(form.memberPrice),
    validFrom: toIso(form.validFrom),
    validUntil: toIso(form.validUntil),
    conditions: form.conditions.trim() || null,
    remaining: intOrNull(form.remaining),
    perPersonLimit: intOrNull(form.perPerson),
  })

  const save = async () => {
    setBusy(true)
    setMessage(null)
    try {
      if (creating) {
        const created = await merchantApi.createOffer(body())
        navigate(`../${created.id}`, { relative: 'path', replace: true })
        return
      }
      const next = await merchantApi.updateOffer(offer!.id, { ...body(), version: offer!.version })
      setOffer(next)
      setMessage({ tone: 'success', text: t.merchantOffers.saved })
    } catch (err) {
      console.error('OfferEditor.save', err instanceof ApiError ? err.problem : err)
      if (err instanceof ApiError && err.status === 409) setMessage({ tone: 'danger', text: t.merchantOffers.refusals.conflict })
    } finally {
      setBusy(false)
    }
  }

  const limitText = (check: FileCheck) => ({
    ok: null,
    unsupported: t.merchantStore.limits.unsupported,
    'image-too-large': t.merchantStore.limits.imageTooLarge,
    'video-too-large': t.merchantStore.limits.videoTooLarge,
  })[check]

  const setMedia = async (assetIds: string[]) => {
    if (!offer) return
    setBusy(true)
    try {
      setOffer(await merchantApi.setOfferMedia(offer.id, assetIds))
    } catch (err) {
      console.error('OfferEditor.setMedia', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const addMedia = async (file: File | undefined) => {
    if (!file || !offer) return
    const text = limitText(checkMerchantFile(file))
    if (text) { setMessage({ tone: 'danger', text }); return }
    setMessage(null)
    const asset = await upload.start(file, fill(t.merchantOffers.mediaItemAlt, { n: offer.media.length + 1, title: offer.title }))
    if (asset) await setMedia([...offer.media.map((m) => m.assetId), asset.id])
  }

  const removeMedia = async (item: MediaItem) => {
    if (!offer) return
    await setMedia(offer.media.filter((m) => m.assetId !== item.assetId).map((m) => m.assetId))
    // Free the storage; quiet, because a refusal means something else still uses it.
    void merchantApi.deleteFile(item.assetId).catch(() => undefined)
  }

  /**
   * Choose which existing file leads (feature 042). The server moves it to the front and
   * answers the new order, which is what is shown: this page decides nothing about it.
   * Not `setMedia`: that replaces the whole set from this page's copy, which could drop a
   * file added from another tab.
   */
  const makeMain = async (item: MediaItem) => {
    if (!offer) return
    setBusy(true)
    try {
      const result = await merchantApi.setMainMedia(offer.id, item.assetId)
      setOffer((current) => (current ? { ...current, media: result.media } : current))
    } catch (err) {
      console.error('OfferEditor.makeMain', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  if (loading || !categories) return <PageLoader />

  const categoryName = (c: OfferCategory) => (locale === 'en' ? c.nameEn : c.nameDe)
  const mediaFull = (offer?.media.length ?? 0) >= MAX_OFFER_MEDIA
  const canSave = form.title.trim() !== '' && form.categoryId !== '' && form.validFrom !== '' && form.validUntil !== ''

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={creating ? t.merchantOffers.editorNew : t.merchantOffers.editorEdit}
        actions={<Link to={creating ? '..' : '..'} relative="path" className="text-[13px] text-navy">← {t.merchantOffers.back}</Link>}
      />
      {message && <FormMessage ref={messageRef} tone={message.tone}>{message.text}</FormMessage>}

      <Card>
        <div className="flex flex-col gap-4">
          <Field label={t.merchantOffers.fieldTitle} value={form.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.merchantOffers.fieldDescription}
            <textarea value={form.description} maxLength={4000} rows={4} onChange={(e) => set('description', e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
          </label>

          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.merchantOffers.category}
            <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text">
              <option value="">{t.merchantOffers.categoryChoose}</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{categoryName(c)}</option>)}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.merchantOffers.kind}
            <select value={form.benefitKind} onChange={(e) => set('benefitKind', e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text">
              {NEW_OFFER_KINDS.map((k) => <option key={k} value={k}>{t.merchantOffers.kinds[k]}</option>)}
              {/* An offer that already has an older kind keeps showing it. */}
              {!NEW_OFFER_KINDS.includes(form.benefitKind as (typeof NEW_OFFER_KINDS)[number]) && (
                <option value={form.benefitKind}>{t.merchantOffers.kinds[form.benefitKind as keyof typeof t.merchantOffers.kinds]}</option>
              )}
            </select>
          </label>

          {!noValue && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t.merchantOffers.value} type="number" min={0} value={form.benefitValue} onChange={(e) => set('benefitValue', e.target.value)} />
              <Field label={t.merchantOffers.regularPrice} type="number" min={0} value={form.regularPrice} onChange={(e) => set('regularPrice', e.target.value)} />
              <Field label={t.merchantOffers.memberPrice} type="number" min={0} value={form.memberPrice} onChange={(e) => set('memberPrice', e.target.value)} />
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.merchantOffers.validFrom} type="datetime-local" value={form.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
            <Field label={t.merchantOffers.validUntil} type="datetime-local" value={form.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t.merchantOffers.remaining} type="number" min={1} hint={t.merchantOffers.remainingHint}
              value={form.remaining} onChange={(e) => set('remaining', e.target.value)} />
            <Field label={t.merchantOffers.perPerson} type="number" min={1} hint={t.merchantOffers.perPersonHint}
              value={form.perPerson} onChange={(e) => set('perPerson', e.target.value)} />
          </div>

          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.merchantOffers.conditions}
            <textarea value={form.conditions} maxLength={2000} rows={3} onChange={(e) => set('conditions', e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
          </label>

          <div><Button loading={busy} disabled={!canSave} onClick={() => void save()}>{t.merchantOffers.save}</Button></div>
        </div>
      </Card>

      <Card title={t.merchantOffers.media}>
        {!offer ? (
          <p className="text-[13px] text-text-muted">{t.merchantOffers.saveFirst}</p>
        ) : (
          <>
            <p className="mb-3 text-[13px] text-text-muted">{fill(t.merchantOffers.mediaHint, { max: MAX_OFFER_MEDIA })}</p>
            {/* The server's `media: []` means none; the club's fallback is for members, so it is not drawn here as if it were a file. */}
            {offer.media.length === 0 && <p className="mb-3 text-[13px] text-text-muted">{t.merchantOffers.mediaNone}</p>}
            <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              {offer.media.map((item, index) => (
                <li key={item.assetId} className="flex flex-col gap-1.5">
                  <div className="relative">
                    <OfferPicture item={item} maxWidth={160} />
                    {/* The first one leads: it is the card's picture and the detail's first slide. */}
                    {index === 0 && (
                      <span className="absolute left-1.5 top-1.5 rounded-card bg-navy px-2 py-0.5 text-[11px] font-semibold text-text-on-dark">
                        {t.merchantOffers.mainBadge}
                      </span>
                    )}
                  </div>
                  {index > 0 && (
                    <Button variant="quiet" disabled={busy} onClick={() => void makeMain(item)}>{t.merchantOffers.makeMain}</Button>
                  )}
                  <Button variant="quiet" disabled={busy} onClick={() => void removeMedia(item)}>{t.merchantOffers.mediaRemove}</Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" disabled={busy || mediaFull || upload.state.phase === 'uploading' || upload.state.phase === 'processing'}
                onClick={() => input.current?.click()}>{t.merchantOffers.mediaAdd}</Button>
              {mediaFull && <span className="text-[12px] text-text-muted">{fill(t.merchantOffers.mediaFull, { max: MAX_OFFER_MEDIA })}</span>}
              <input ref={input} type="file" accept={MERCHANT_MEDIA_TYPES.join(',')} className="sr-only" tabIndex={-1}
                aria-label={t.merchantOffers.mediaAdd} onChange={(e) => { void addMedia(e.target.files?.[0]); e.target.value = '' }} />
            </div>
            <div className="mt-3"><UploadProgress state={upload.state} label={t.merchantOffers.media} onCancel={upload.cancel} /></div>
          </>
        )}
      </Card>
    </div>
  )
}

export default OfferEditor
