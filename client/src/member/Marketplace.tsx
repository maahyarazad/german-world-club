import { useEffect, useState, useCallback } from 'react'
import { get, post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import { CONTACT_METHODS, MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace'
import type {
  CategoryDef, FieldDef, VehicleFeature, Listing, ListingPage, TermsResponse,
} from '@gwc/contracts/marketplace'
import MediaPicker from './MediaPicker'
import type { PendingMedia, MediaStatus } from './MediaPicker'
import { useCapabilities } from '../lib/capabilities'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Field from '../components/ui/Field'
import Callout from '../components/ui/Callout'
import StatusPill from '../components/ui/StatusPill'
import { useLocale, useTranslations } from '../i18n/index'
import { formatDate } from '../lib/format'

/**
 * The marketplace tab in the member web app (008 US6).
 *
 * §7's classifieds, on the shared member-audience API — the same one the
 * mobile face calls (FR-031). Nothing here is a second source of truth: the
 * compose form's fields come from `GET /marketplace/categories`, never from a
 * list declared in this file, so a category added on the server needs no
 * client change to become postable (Principle I). The only things imported
 * directly from `@gwc/contracts/marketplace` are enums the SERVER branches on
 * — `CONTACT_METHODS`, the category and mode lists — which is the shared
 * package doing exactly the job it exists for.
 */

const MODE_TONE = { offer: 'success', request: 'info' } as const

/**
 * The refusal as the member should read it: the localised title, plus which
 * fields were refused when the server names them. Branches on `type` via
 * `describeProblem`; `problems` is structured data, never parsed prose.
 */
function describeError(err: ApiError, locale: string): string {
  const title = describeProblem(err.problem, locale as never).title
  const fields = (err.problem as { problems?: Array<{ field?: string }> })?.problems
    ?.map((p) => p.field).filter(Boolean)
  return fields && fields.length > 0 ? `${title}: ${fields.join(', ')}` : title
}

type UploadedAsset = { id: string; state: string }

/**
 * Upload one file, wait for it to be usable, attach it.
 *
 * `alt` is appended BEFORE the file: the server reads the fields that precede
 * the file part, so an alt sent after it arrives as missing. A video comes
 * back `processing` and cannot be attached until it is `ready` — the attach
 * route refuses it rather than let the index render a listing whose
 * derivatives do not exist — so this waits, bounded, rather than failing.
 */
async function uploadAndAttach(
  listingId: string,
  item: PendingMedia,
  onStatus: (status: MediaStatus) => void,
) {
  const form = new FormData()
  form.append('alt', item.alt.trim())
  form.append('file', item.file)
  onStatus('uploading')
  let asset = (await post('/media', form)) as UploadedAsset

  if (asset.state === 'processing') onStatus('processing')
  for (let waited = 0; asset.state === 'processing' && waited < 120_000; waited += 2_000) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    asset = (await get(`/media/${asset.id}`)) as UploadedAsset
  }
  if (asset.state !== 'ready') throw new Error(`asset ${asset.id} is ${asset.state}`)

  await post(`/marketplace/listings/${listingId}/media`, { assetId: asset.id })
}

function DetailField({
  def, value, onChange,
}: { def: FieldDef; value: unknown; onChange: (value: unknown) => void }) {
  const t = useTranslations()
  const label = `${def.key}${def.required ? ' *' : ''}`

  if (def.kind === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[13px] text-text">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
    )
  }

  if (def.kind === 'enum') {
    return (
      <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {label}
        <select
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value || undefined)}
          className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
        >
          <option value="">{t.memberMarketplace.selectPlaceholder}</option>
          {(def.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </label>
    )
  }

  const inputType = def.kind === 'date' ? 'date' : ['integer', 'decimal', 'money'].includes(def.kind) ? 'number' : 'text'
  return (
    <Field
      label={label}
      type={inputType}
      value={value === undefined || value === null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    />
  )
}

function ComposeListing({ categories, vehicleFeatures, loadFailed, onPosted }: {
  categories: readonly CategoryDef[]
  vehicleFeatures: readonly VehicleFeature[]
  loadFailed: boolean
  onPosted: () => void
}) {
  const t = useTranslations()
  const { locale } = useLocale()
  const [category, setCategory] = useState<string>(categories[0]?.category ?? '')
  const [mode, setMode] = useState<string>('offer')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [contactMethod, setContactMethod] = useState<string>('platform_message')
  const [expiresAt, setExpiresAt] = useState('')
  const [details, setDetails] = useState<Record<string, unknown>>({})
  const [features, setFeatures] = useState<Set<string>>(new Set())
  const [terms, setTerms] = useState<TermsResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posted, setPosted] = useState(false)
  const [media, setMedia] = useState<PendingMedia[]>([])
  // The listing whose media are still being (or failed being) attached, so a
  // retry attaches to it rather than creating a second listing.
  const [attachingTo, setAttachingTo] = useState<string | null>(null)
  const [termsFailed, setTermsFailed] = useState(false)

  useEffect(() => {
    // Not swallowed. A terms fetch that failed silently left `terms` null, and
    // the button then looked enabled while `submit` returned without a word.
    void get('/marketplace/terms')
      .then((body) => { setTerms(body as TermsResponse); setTermsFailed(false) })
      .catch(() => setTermsFailed(true))
  }, [])

  // The categories arrive after this component mounts, so the initial state
  // above is '' on every real page load — and `useState` never looks at its
  // initialiser again. Without this the form posted `category: ''`, rendered
  // none of the category's own fields, and every publish failed validation.
  useEffect(() => {
    if (!category && categories[0]) setCategory(categories[0].category)
  }, [categories, category])

  // Category-specific fields reset with the category — a `price_minor` typed
  // in for `vehicle` means nothing once the category becomes `job`, and
  // leaving it in `details` would fail the server's validation with an
  // "unknown field" error the member never asked for.
  const activeDef = categories.find((c) => c.category === category)

  const setDetail = (key: string, value: unknown) =>
    setDetails((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[key]
      else next[key] = value
      return next
    })

  const toggleFeature = (key: string) =>
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const acceptTerms = async () => {
    if (!terms) return
    setBusy(true)
    try {
      const updated = await post('/marketplace/terms/accept') as TermsResponse
      setTerms(updated)
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err, locale) : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!terms) return
    // Alt text is required at ingest (§10.1). Refusing here, before the
    // listing exists, beats publishing it and then failing every upload.
    if (media.some((m) => m.alt.trim().length === 0)) {
      setError(t.memberMarketplace.mediaAltMissing)
      return
    }
    setBusy(true)
    setError(null)
    setPosted(false)
    let listingId: string | null = null
    try {
      const created = (await post('/marketplace/listings', {
        category, mode, title, body,
        details: Object.keys(details).length > 0 ? details : {},
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
        termsVersion: terms.version,
      })) as { id: string }
      listingId = created.id
    } catch (err) {
      setError(err instanceof ApiError ? describeError(err, locale) : String(err))
      setBusy(false)
      return
    }

    setAttachingTo(listingId)
    const failed = await attachAll(listingId, media)

    setTitle('')
    setBody('')
    setDetails({})
    setFeatures(new Set())
    setPosted(true)
    onPosted()
    if (failed.length > 0) {
      // Keep only what failed, so the member sees which files and can retry
      // them against the listing that now exists.
      setMedia(failed)
      setError(t.memberMarketplace.mediaFailed)
    } else {
      setMedia([])
      setAttachingTo(null)
    }
    setBusy(false)
  }

  const setStatus = (key: string, status: MediaStatus) =>
    setMedia((prev) => prev.map((m) => (m.key === key ? { ...m, status } : m)))

  /**
   * One at a time and in the order shown: the first attached represents the
   * listing in the index. Returns what failed, marked as failed.
   */
  const attachAll = async (listingId: string, items: readonly PendingMedia[]) => {
    const failed: PendingMedia[] = []
    for (const item of items) setStatus(item.key, 'pending')
    for (const item of items) {
      try {
        await uploadAndAttach(listingId, item, (status) => setStatus(item.key, status))
        setStatus(item.key, 'attached')
      } catch {
        setStatus(item.key, 'failed')
        failed.push({ ...item, status: 'failed' })
      }
    }
    return failed
  }

  const retryMedia = async () => {
    if (!attachingTo) return
    setBusy(true)
    setError(null)
    const failed = await attachAll(attachingTo, media)
    if (failed.length > 0) {
      setMedia(failed)
      setError(t.memberMarketplace.mediaFailed)
    } else {
      setMedia([])
      setAttachingTo(null)
      onPosted()
    }
    setBusy(false)
  }

  // Loaded AND equal. `undefined === undefined` made an unloaded terms record
  // read as accepted, which is how the button came to be enabled for nothing.
  const termsAccepted = terms !== null && terms.acceptedVersion === terms.version
  const ready = categories.length > 0 && terms !== null && category !== ''

  return (
    <Card title={t.memberMarketplace.composeTitle}>
      <div className="flex flex-col gap-4">
        {(loadFailed || termsFailed) && <Callout variant="neutral" title={t.memberMarketplace.loadFailed} />}
        {posted && <Callout variant="info" title={t.memberMarketplace.posted} />}
        {error && <Callout variant="neutral" title={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.category}
            <select
              value={category}
              onChange={(e) => { setCategory(e.target.value); setDetails({}); setFeatures(new Set()) }}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              {categories.map((c) => (
                <option key={c.category} value={c.category}>{t.memberMarketplace.categories[c.category] ?? c.category}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.mode}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              {MARKETPLACE_MODES.map((m) => (
                <option key={m} value={m}>{t.memberMarketplace.modes[m]}</option>
              ))}
            </select>
          </label>
        </div>

        <Field label={t.memberMarketplace.titleField} value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {t.memberMarketplace.body}
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
          />
        </label>

        {activeDef && activeDef.fields.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {activeDef.fields.map((def) => (
              <DetailField key={def.key} def={def} value={details[def.key]} onChange={(v) => setDetail(def.key, v)} />
            ))}
          </div>
        )}

        {category === 'vehicle' && vehicleFeatures.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t.memberMarketplace.features}
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {vehicleFeatures.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-[13px] text-text">
                  <input type="checkbox" checked={features.has(f.key)} onChange={() => toggleFeature(f.key)} />
                  {f.key}
                </label>
              ))}
            </div>
          </div>
        )}

        <MediaPicker items={media} onChange={setMedia} onError={setError} disabled={busy} />

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.contactMethod}
            <select
              value={contactMethod}
              onChange={(e) => setContactMethod(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              {CONTACT_METHODS.map((m) => <option key={m} value={m}>{t.memberMarketplace.contactMethods[m]}</option>)}
            </select>
          </label>

          <Field
            label={t.memberMarketplace.expiresAt}
            type="date"
            hint={t.memberMarketplace.expiresAtHint}
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>

        {!termsAccepted && terms && (
          <Callout variant="gold" title={t.memberMarketplace.termsRequired}>
            <Button variant="secondary" className="mt-2" disabled={busy} onClick={acceptTerms}>
              {t.memberMarketplace.acceptTerms}
            </Button>
          </Callout>
        )}

        <div>
          <Button
            variant="accent"
            disabled={busy || !ready || !termsAccepted || title.trim().length < 3 || body.trim().length < 10}
            onClick={submit}
          >
            {busy ? t.memberMarketplace.publishing : t.memberMarketplace.submit}
          </Button>
          {attachingTo && media.some((m) => m.status === 'failed') && !busy && (
            <Button variant="secondary" className="ml-2" onClick={retryMedia}>
              {t.memberMarketplace.mediaRetry}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

export function Marketplace() {
  const t = useTranslations()
  const { locale } = useLocale()
  const { snapshot } = useCapabilities()

  const [categories, setCategories] = useState<readonly CategoryDef[]>([])
  const [vehicleFeatures, setVehicleFeatures] = useState<readonly VehicleFeature[]>([])
  const [category, setCategory] = useState<string>('')
  const [mode, setMode] = useState<string>('')
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [categoriesFailed, setCategoriesFailed] = useState(false)

  // Whether COMPOSE renders at all — absent, not disabled, without the flag
  // (the same rule RequireGrant.tsx states for staff modules; members hold
  // this one as a per-member permission, resolved the same way everywhere).
  const permissions = (snapshot?.permissions as string[] | undefined) ?? []
  const canPost = permissions.includes('marketplace_post')

  useEffect(() => {
    void get('/marketplace/categories').then((body) => {
      const parsed = body as { categories: CategoryDef[]; vehicleFeatures: VehicleFeature[] }
      setCategories(parsed.categories)
      setVehicleFeatures(parsed.vehicleFeatures)
      setCategoriesFailed(false)
    }).catch(() => setCategoriesFailed(true))
  }, [])

  const loadListings = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (mode) params.set('mode', mode)
    const qs = params.toString()
    try {
      const page = (await get(`/marketplace/listings${qs ? `?${qs}` : ''}`, { signal })) as ListingPage
      setListings([...page.items])
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof ApiError ? describeProblem(err.problem, locale).title : String(err))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, mode])

  useEffect(() => {
    const controller = new AbortController()
    void loadListings(controller.signal)
    return () => controller.abort()
  }, [loadListings])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t.memberMarketplace.title} subtitle={t.memberMarketplace.subtitle} />

      {canPost && (
        <ComposeListing
          categories={categories}
          vehicleFeatures={vehicleFeatures}
          loadFailed={categoriesFailed}
          onPosted={() => void loadListings()}
        />
      )}

      <Card title={t.memberMarketplace.browseTitle}>
        <div className="mb-4 grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.category}
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              <option value="">{t.memberMarketplace.allCategories}</option>
              {MARKETPLACE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{t.memberMarketplace.categories[c] ?? c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.mode}
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text"
            >
              <option value="">{t.memberMarketplace.allModes}</option>
              {MARKETPLACE_MODES.map((m) => <option key={m} value={m}>{t.memberMarketplace.modes[m]}</option>)}
            </select>
          </label>
        </div>

        {loadError && <Callout variant="neutral" title={loadError} />}

        {listings === null ? null : listings.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">{t.memberMarketplace.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {listings.map((listing) => (
              <li key={listing.id} className="rounded-card border border-hairline p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[15px] font-semibold text-text">{listing.title}</p>
                    <p className="mt-1 text-[13px] text-text-muted">{listing.body}</p>
                  </div>
                  <StatusPill tone={MODE_TONE[listing.mode] ?? 'neutral'}>
                    {t.memberMarketplace.modes[listing.mode] ?? listing.mode}
                  </StatusPill>
                </div>
                <p className="mt-2 text-[11px] text-text-muted">
                  {t.memberMarketplace.categories[listing.category] ?? listing.category}
                  {' · '}
                  {formatDate(listing.createdAt, locale)}
                  {listing.owner?.displayName ? ` · ${listing.owner.displayName}` : ''}
                </p>
                {!listing.contact?.available && (
                  <p className="mt-1 text-[11px] text-text-muted">{t.memberMarketplace.contactUnavailable}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export default Marketplace
