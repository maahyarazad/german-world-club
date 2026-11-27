import { useEffect, useRef, useState, useCallback } from 'react'
import { get, post, patch, del, ApiError } from '../lib/api'
import { PROBLEMS } from '@gwc/contracts/errors'
import { CONTACT_METHODS, MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace'
import { SEARCH_MIN_LENGTH } from '@gwc/contracts/search'
import type {
  CategoryDef, FieldDef, VehicleFeature, Listing, ListingPage, TermsResponse, OwnListing,
} from '@gwc/contracts/marketplace'
import MediaPicker from './MediaPicker'
import type { PendingMedia, MediaStatus } from './MediaPicker'
import { useCapabilities } from '../lib/capabilities'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Field from '../components/ui/Field'
import Callout from '../components/ui/Callout'
import Drawer from '../components/ui/Drawer'
import StatusPill from '../components/ui/StatusPill'
import ListingRequest from './ListingRequest'
import MyListings from './MyListings'
import { useLocale, useTranslations } from '../i18n/index'
import { formatDate } from '../lib/format'
import { useReveal } from '../lib/useReveal'
import { useDebouncedValue } from '../lib/useDebouncedValue'
import SearchField from '../components/ui/SearchField'
import PageLoader from '../components/ui/PageLoader'

/**
 * The marketplace tab in the member web app (008 US6).
 *
 * Browsing comes first (feature 017): the compose form is not on the page but
 * in a drawer that slides in from the right, opened by the New listing button
 * in the header. Every member sees them since feature 021 (no per-member flag);
 * they are absent — not disabled — for anyone who is not a member.
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

function ComposeListing({ categories, vehicleFeatures, loadFailed, onPosted, editId = null }: {
  categories: readonly CategoryDef[]
  vehicleFeatures: readonly VehicleFeature[]
  loadFailed: boolean
  /**
   * Feature 037: when set, this form edits that listing instead of creating
   * one. The page mounts it with `key={editId}` so switching between listings
   * never carries one listing's fields into another.
   */
  editId?: string | null
  /**
   * `complete` is false when the listing exists but some media did not
   * attach: the page keeps the drawer open then, because the retry lives in
   * this form.
   */
  onPosted: (result: { complete: boolean }) => void
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
  const [media, setMedia] = useState<PendingMedia[]>([])
  // The listing whose media are still being (or failed being) attached, so a
  // retry attaches to it rather than creating a second listing.
  const [attachingTo, setAttachingTo] = useState<string | null>(null)
  const [termsFailed, setTermsFailed] = useState(false)
  // Feature 037. A new listing starts published (the clarified default); an
  // edit starts from the listing's own state and only sends `published` when
  // the member changed it.
  const [publish, setPublish] = useState(true)
  const editing = editId !== null
  type Existing = { version: string; state: string; canEdit: boolean; moderated: boolean; publishedAtLoad: boolean; expiresAtLoad: string }
  const [existing, setExisting] = useState<Existing | null>(null)
  const [existingMedia, setExistingMedia] = useState<OwnListing['media']>([])
  // Flags that change behaviour, not stored refusals: a stale form offers a
  // reload, and a form that cannot load shows the load-failed note.
  const [stale, setStale] = useState(false)
  const [editFailed, setEditFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!editId) return
    const controller = new AbortController()
    setEditFailed(false)
    get(`/marketplace/mine/${editId}`, { signal: controller.signal })
      .then((body) => {
        const l = body as OwnListing & { details: Record<string, unknown>; features: string[] }
        setCategory(l.category)
        setMode(l.mode)
        setTitle(l.title)
        setBody(l.body)
        setContactMethod(l.contact?.method ?? 'platform_message')
        const expires = l.expiresAt ? new Date(l.expiresAt).toISOString().slice(0, 10) : ''
        setExpiresAt(expires)
        // The database returns every column of the detail row, nulls included;
        // a null is "not set", and sending it back would fail validation.
        setDetails(Object.fromEntries(Object.entries(l.details ?? {}).filter(([, v]) => v !== null && v !== undefined)))
        setFeatures(new Set(l.features ?? []))
        setPublish(l.state === 'active')
        setExistingMedia(l.media ?? [])
        setStale(false)
        setExisting({
          version: l.version, state: l.state, canEdit: l.canEdit, moderated: l.moderated,
          publishedAtLoad: l.state === 'active', expiresAtLoad: expires,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        console.error('ComposeListing.loadListing', err instanceof ApiError ? err.problem : err)
        setEditFailed(true)
      })
    return () => controller.abort()
  }, [editId, reloadKey])

  useEffect(() => {
    // Editing needs no terms: they were accepted when the listing was posted.
    if (editing) return
    // Not swallowed. A terms fetch that failed silently left `terms` null, and
    // the button then looked enabled while `submit` returned without a word.
    void get('/marketplace/terms')
      .then((body) => { setTerms(body as TermsResponse); setTermsFailed(false) })
      .catch((err) => {
        console.error('ComposeListing.loadTerms', err instanceof ApiError ? err.problem : err)
        setTermsFailed(true)
      })
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
  // Which modes this category allows comes from the server's definition (a
  // member may only REQUEST a job, feature 021) — display only; the server
  // re-checks. Falls back to both while the definitions load.
  const allowedModes: readonly string[] = activeDef?.modes ?? MARKETPLACE_MODES
  const onlyMode = allowedModes.length === 1

  // A mode the new category does not allow moves to the first one it does, so
  // the form can always be sent (an Offer becomes a Request when Job is chosen).
  useEffect(() => {
    if (!allowedModes.includes(mode)) setMode(allowedModes[0] ?? 'request')
  }, [allowedModes, mode])

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
      console.error('ComposeListing.acceptTerms', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (editing) return saveEdit()
    if (!terms) return
    // Alt text is required at ingest (§10.1). Refusing here, before the
    // listing exists, beats publishing it and then failing every upload.
    if (media.some((m) => m.alt.trim().length === 0)) {
      setError(t.memberMarketplace.mediaAltMissing)
      return
    }
    setBusy(true)
    setError(null)
    let listingId: string | null = null
    try {
      const created = (await post('/marketplace/listings', {
        category, mode, title, body,
        details: Object.keys(details).length > 0 ? details : {},
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString(),
        termsVersion: terms.version,
        // Unticked saves a private draft; ticked (the default) goes live.
        publish,
      })) as { id: string }
      listingId = created.id
    } catch (err) {
      console.error('ComposeListing.submit', err instanceof ApiError ? err.problem : err)
      // Shown as well as logged: only reachable with a stale category list,
      // and the member cannot proceed without knowing why (CLAUDE.md).
      if (err instanceof ApiError && err.problem?.type === PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED.type) {
        setError(t.memberMarketplace.jobOfferNote)
      }
      setBusy(false)
      return
    }

    setAttachingTo(listingId)
    const failed = await attachAll(listingId, media)

    setTitle('')
    setBody('')
    setDetails({})
    setFeatures(new Set())
    onPosted({ complete: failed.length === 0 })
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

  /**
   * Save an edit (feature 037): one PATCH carries the fields, the expiry and
   * the Publish choice, so they succeed or fail together. `version` is the one
   * this form was loaded from; if the listing changed elsewhere the server says
   * so (409) and the member is offered a reload rather than an overwrite.
   */
  const saveEdit = async () => {
    if (!existing || !editId) return
    if (media.some((m) => m.alt.trim().length === 0)) {
      setError(t.memberMarketplace.mediaAltMissing)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = (await patch(`/marketplace/listings/${editId}`, {
        version: existing.version,
        title, body, category, details,
        ...(category === 'vehicle' ? { features: [...features] } : {}),
        contactMethod,
        // Only when the member changed it: re-sending an unchanged date would
        // round it to midnight and make the form look edited when it was not.
        ...(expiresAt !== existing.expiresAtLoad
          ? { expiresAt: expiresAt === '' ? null : new Date(expiresAt).toISOString() }
          : {}),
        ...(publish !== existing.publishedAtLoad ? { published: publish } : {}),
      })) as { version: string; state: string }
      setExisting({ ...existing, version: saved.version, state: saved.state, publishedAtLoad: saved.state === 'active' })
    } catch (err) {
      console.error('ComposeListing.saveEdit', err instanceof ApiError ? err.problem : err)
      if (err instanceof ApiError && err.problem?.type === PROBLEMS.CONFLICT.type) {
        // Shown as well as logged: the member cannot proceed without knowing the
        // form is out of date, and the reload is the way forward.
        setStale(true)
        setError(t.memberMarketplace.conflict)
      } else if (err instanceof ApiError && err.problem?.type === PROBLEMS.MARKETPLACE_NOT_EDITABLE.type) {
        setError(t.memberMarketplace.notEditable)
      } else if (err instanceof ApiError && err.problem?.type === PROBLEMS.MARKETPLACE_MODE_NOT_ALLOWED.type) {
        setError(t.memberMarketplace.jobOfferNote)
      } else if (err instanceof ApiError && /expiresAt/.test(err.problem?.detail ?? '')) {
        setError(t.memberMarketplace.expiryMustBeFuture)
      }
      setBusy(false)
      return
    }

    // New photos go to the listing that now exists; the version does not move.
    const failed = await attachAll(editId, media)
    if (failed.length > 0) {
      setMedia(failed)
      setAttachingTo(editId)
      setError(t.memberMarketplace.mediaFailed)
      onPosted({ complete: false })
    } else {
      setMedia([])
      onPosted({ complete: true })
    }
    setBusy(false)
  }

  /** Remove a photo already on the listing. It is its own request and does not move the version. */
  const removeExisting = async (assetId: string) => {
    if (!editId) return
    setBusy(true)
    try {
      await del(`/marketplace/listings/${editId}/media/${assetId}`)
      setExistingMedia((all) => all.filter((m) => m.assetId !== assetId))
    } catch (err) {
      console.error('ComposeListing.removeExisting', err instanceof ApiError ? err.problem : err)
    } finally {
      setBusy(false)
    }
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
      } catch (err) {
        console.error('ComposeListing.attachAll', err instanceof ApiError ? err.problem : err)
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
      onPosted({ complete: true })
    }
    setBusy(false)
  }

  // Loaded AND equal. `undefined === undefined` made an unloaded terms record
  // read as accepted, which is how the button came to be enabled for nothing.
  const termsAccepted = editing || (terms !== null && terms.acceptedVersion === terms.version)
  const ready = editing
    ? existing !== null && existing.canEdit && category !== ''
    : categories.length > 0 && terms !== null && category !== ''

  // An edit form waits for the listing before showing any field: nothing
  // renders as empty and then jumps to the saved values.
  if (editing && editFailed) return <Callout variant="neutral" title={t.memberMarketplace.editLoadFailed} />
  if (editing && existing === null) return <PageLoader size="md" className="min-h-0 py-6" />

  return (
    // No Card: the drawer carries the heading (composeTitle) and the frame.
    <div className="flex flex-col gap-4">
      {(loadFailed || termsFailed) && <Callout variant="neutral" title={t.memberMarketplace.loadFailed} />}
      {existing?.moderated && <Callout variant="neutral" title={t.memberMarketplace.publishDisabledByStaff} />}
      {existing && !existing.canEdit && !existing.moderated && <Callout variant="neutral" title={t.memberMarketplace.notEditable} />}
      {error && (
        <Callout variant="neutral" title={error}>
          {stale && (
            <Button variant="secondary" className="mt-2" onClick={() => setReloadKey((k) => k + 1)}>
              {t.memberMarketplace.reload}
            </Button>
          )}
        </Callout>
      )}

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
            disabled={editing}
            onChange={(e) => setMode(e.target.value)}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text disabled:opacity-60"
          >
            {allowedModes.map((m) => (
              <option key={m} value={m}>{t.memberMarketplace.modes[m as keyof typeof t.memberMarketplace.modes] ?? m}</option>
            ))}
          </select>
        </label>
      </div>
      {onlyMode && !editing && <p className="-mt-2 text-[12px] text-text-muted">{t.memberMarketplace.jobOfferNote}</p>}
      {editing && <p className="-mt-2 text-[12px] text-text-muted">{t.memberMarketplace.modeLocked}</p>}

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

      {editing && existingMedia.length > 0 && (
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
            {t.memberMarketplace.mediaCurrent}
          </p>
          <ul className="flex flex-col gap-2">
            {existingMedia.map((m) => (
              <li key={m.assetId} className="flex items-center justify-between gap-3 rounded-card border border-hairline p-2">
                <span className="text-[13px] text-text">{m.alt || m.kind}</span>
                <Button variant="quiet" disabled={busy || !existing?.canEdit} onClick={() => removeExisting(m.assetId)}>
                  {t.memberMarketplace.mediaRemoveCurrent}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MediaPicker items={media} onChange={setMedia} onError={setError} disabled={busy || (editing && !existing?.canEdit)} />

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

      {/* The Publish checkbox (feature 037). It starts ticked on a new listing; on an
          edit it shows the listing's own state. Display only: the server decides
          whether publishing is allowed and refuses a disabled listing. */}
      <label className="flex items-start gap-2 text-[13px] text-text">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={publish}
          disabled={busy || (editing && (!existing || !existing.canEdit))}
          onChange={(e) => setPublish(e.target.checked)}
        />
        <span>
          <span className="font-semibold">{t.memberMarketplace.publish}</span>
          <span className="block text-[12px] text-text-muted">{t.memberMarketplace.publishHint}</span>
        </span>
      </label>

      {!termsAccepted && terms && (
        <Callout variant="gold" title={t.memberMarketplace.termsRequired}>
          <Button variant="secondary" className="mt-2" loading={busy} onClick={acceptTerms}>
            {t.memberMarketplace.acceptTerms}
          </Button>
        </Callout>
      )}

      <div>
        <Button
          variant="accent"
          loading={busy}
          disabled={!ready || !termsAccepted || title.trim().length < 3 || body.trim().length < 10 || (stale && editing)}
          onClick={submit}
        >
          {editing ? t.memberMarketplace.saveChanges : publish ? t.memberMarketplace.submit : t.memberMarketplace.saveDraft}
        </Button>
        {attachingTo && media.some((m) => m.status === 'failed') && !busy && (
          <Button variant="secondary" className="ml-2" onClick={retryMedia}>
            {t.memberMarketplace.mediaRetry}
          </Button>
        )}
      </div>
    </div>
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
  // The text search (feature 042): the box, and what is actually sent once the person pauses and has typed
  // enough. Each answer is stored with the category, mode and search it answers and shown only while that is
  // still what is asked for, so the loader shows until the right answer arrives and an old answer that lands
  // late cannot replace a newer one.
  const [text, setText] = useState('')
  const typed = text.trim()
  const q = useDebouncedValue(typed.length >= SEARCH_MIN_LENGTH ? typed : '')
  const key = `${category}|${mode}|${q}`
  const [result, setResult] = useState<{ key: string; items: Listing[]; nextCursor: string | null } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const listings = result?.key === key ? result.items : null
  const nextCursor = result?.key === key ? result.nextCursor : null
  const [categoriesFailed, setCategoriesFailed] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  // On the page, not in the form: a complete publish closes the drawer, and a
  // confirmation inside a closed drawer is one nobody sees.
  const [posted, setPosted] = useState(false)
  // Feature 037: the member's own listings, and which one is open for editing.
  // `editId` set means the drawer edits that listing; null means a new one.
  const [view, setView] = useState<'browse' | 'mine'>('browse')
  const [editId, setEditId] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [mineKey, setMineKey] = useState(0)
  const newListingButton = useRef<HTMLButtonElement>(null)
  // The outcome shown below is far above a list the member has scrolled down,
  // and the drawer that made it has just closed: bring it into view (feature
  // 041). Both flags are reset when the drawer opens, so each success is a
  // false-to-true change; only one of the two callouts is ever on screen, so
  // one ref serves both.
  const outcomeRef = useReveal<HTMLDivElement>(posted || saved)

  // Whether the New listing button and its drawer render at all. Display
  // only (Principle I): every member may post since feature 021, and the
  // server refuses anyone else whatever this says.
  const canPost = snapshot?.kind === 'member'

  useEffect(() => {
    void get('/marketplace/categories').then((body) => {
      const parsed = body as { categories: CategoryDef[]; vehicleFeatures: VehicleFeature[] }
      setCategories(parsed.categories)
      setVehicleFeatures(parsed.vehicleFeatures)
      setCategoriesFailed(false)
    }).catch((err) => {
      console.error('Marketplace.loadCategories', err instanceof ApiError ? err.problem : err)
      setCategoriesFailed(true)
    })
  }, [])

  /** The list's address for what is asked for now; `cursor` continues a page. */
  const listUrl = useCallback((cursor?: string) => {
    const params = new URLSearchParams()
    if (category) params.set('category', category)
    if (mode) params.set('mode', mode)
    if (q) params.set('q', q)
    if (cursor) params.set('cursor', cursor)
    const qs = params.toString()
    return `/marketplace/listings${qs ? `?${qs}` : ''}`
  }, [category, mode, q])

  const loadListings = useCallback(async (signal?: AbortSignal) => {
    try {
      const page = (await get(listUrl(), { signal })) as ListingPage
      if (signal?.aborted) return
      setResult({ key, items: [...page.items], nextCursor: page.nextCursor })
    } catch (err) {
      if (signal?.aborted) return
      console.error('Marketplace.loadListings', err instanceof ApiError ? err.problem : err)
    }
  }, [listUrl, key])

  /** The next page of the same search, appended. The page used to ignore the cursor, so only the first page was reachable. */
  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    try {
      const page = (await get(listUrl(nextCursor))) as ListingPage
      setResult((current) => (current?.key === key
        ? { key, items: [...current.items, ...page.items], nextCursor: page.nextCursor }
        : current))
    } catch (err) {
      console.error('Marketplace.loadMore', err instanceof ApiError ? err.problem : err)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void loadListings(controller.signal)
    return () => controller.abort()
  }, [loadListings])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t.memberMarketplace.title}
        subtitle={t.memberMarketplace.subtitle}
        actions={canPost ? (
          <Button
            ref={newListingButton}
            variant="accent"
            aria-haspopup="dialog"
            aria-expanded={composeOpen}
            onClick={() => { setPosted(false); setSaved(false); setEditId(null); setComposeOpen(true) }}
          >
            {t.memberMarketplace.newListing}
          </Button>
        ) : undefined}
      />

      {posted && <Callout ref={outcomeRef} variant="info" title={t.memberMarketplace.posted} />}
      {saved && <Callout ref={outcomeRef} variant="info" title={t.memberMarketplace.saved} />}

      {canPost && (
        <div className="flex gap-2" role="group">
          <Button variant={view === 'browse' ? 'secondary' : 'quiet'} aria-pressed={view === 'browse'} onClick={() => setView('browse')}>
            {t.memberMarketplace.browseTab}
          </Button>
          <Button variant={view === 'mine' ? 'secondary' : 'quiet'} aria-pressed={view === 'mine'} onClick={() => setView('mine')}>
            {t.memberMarketplace.myListings}
          </Button>
        </div>
      )}

      {canPost && (
        <Drawer
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          title={editId ? t.memberMarketplace.editTitle : t.memberMarketplace.composeTitle}
          closeLabel={t.memberMarketplace.close}
          returnFocusTo={newListingButton}
        >
          <ComposeListing
            // A new key per listing: switching from one edit to another, or to
            // a new listing, must never carry fields from the previous one.
            key={editId ?? 'new'}
            editId={editId}
            categories={categories}
            vehicleFeatures={vehicleFeatures}
            loadFailed={categoriesFailed}
            onPosted={({ complete }) => {
              // The listing exists either way, so the lists reload either way.
              void loadListings()
              setMineKey((k) => k + 1)
              if (complete) {
                setComposeOpen(false)
                if (editId) setSaved(true)
                else setPosted(true)
              }
            }}
          />
        </Drawer>
      )}

      {view === 'mine' && canPost && (
        <MyListings
          refreshKey={mineKey}
          onEdit={(id) => { setPosted(false); setSaved(false); setEditId(id); setComposeOpen(true) }}
        />
      )}

      {view === 'browse' && <Card title={t.memberMarketplace.browseTitle}>
        <div className="mb-4">
          <SearchField
            value={text}
            onChange={setText}
            label={t.memberMarketplace.search.label}
            placeholder={t.memberMarketplace.search.placeholder}
            clearLabel={t.memberMarketplace.search.clear}
          />
        </div>
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


        {listings === null ? <PageLoader size="md" className="min-h-0 py-6" /> : listings.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-text-muted">{q ? t.memberMarketplace.search.noResults : t.memberMarketplace.empty}</p>
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
                {/* Feature 020: the way to answer a listing. */}
                <ListingRequest listing={listing} memberId={snapshot?.kind === 'member' ? String(snapshot.id) : undefined} />
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <div className="mt-4">
            <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>{t.memberMarketplace.loadMore}</Button>
          </div>
        )}
      </Card>}
    </div>
  )
}

export default Marketplace
