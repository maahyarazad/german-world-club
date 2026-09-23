import { useEffect, useState, useCallback } from 'react'
import { get, post, ApiError } from '../lib/api'
import { describeProblem } from '../lib/problems'
import { CONTACT_METHODS, MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace'
import type {
  CategoryDef, FieldDef, VehicleFeature, Listing, ListingPage, TermsResponse,
} from '@gwc/contracts/marketplace'
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

function ComposeListing({ categories, vehicleFeatures, onPosted }: {
  categories: readonly CategoryDef[]
  vehicleFeatures: readonly VehicleFeature[]
  onPosted: () => void
}) {
  const t = useTranslations()
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

  useEffect(() => {
    void get('/marketplace/terms').then((body) => setTerms(body as TermsResponse)).catch(() => {})
  }, [])

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
      setError(err instanceof ApiError ? describeProblem(err.problem).title : String(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!terms) return
    setBusy(true)
    setError(null)
    try {
      await post('/marketplace/listings', {
        category, mode, title, body,
        details: Object.keys(details).length > 0 ? details : {},
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
        termsVersion: terms.version,
      })
      setTitle('')
      setBody('')
      setDetails({})
      setFeatures(new Set())
      setPosted(true)
      onPosted()
    } catch (err) {
      setError(err instanceof ApiError ? describeProblem(err.problem).title : String(err))
    } finally {
      setBusy(false)
    }
  }

  const termsAccepted = terms?.acceptedVersion === terms?.version

  return (
    <Card title={t.memberMarketplace.composeTitle}>
      <div className="flex flex-col gap-4">
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
            disabled={busy || !termsAccepted || title.trim().length < 3 || body.trim().length < 10}
            onClick={submit}
          >
            {t.memberMarketplace.submit}
          </Button>
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
    }).catch(() => {})
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
        <ComposeListing categories={categories} vehicleFeatures={vehicleFeatures} onPosted={() => void loadListings()} />
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
