import { useEffect, useRef, useState } from 'react'
import { MAX_STORE_MEDIA } from '@gwc/contracts/media'
import type { MediaItem } from '@gwc/contracts/media'
import type { Store } from '@gwc/contracts/stores'
import { ApiError } from '../lib/api'
import { fill } from '../lib/format'
import { checkCoverFile, checkMerchantFile, MERCHANT_MEDIA_TYPES, MERCHANT_IMAGE_TYPES } from '../lib/media-limits'
import type { CoverCheck, FileCheck } from '../lib/media-limits'
import { useMediaUpload } from '../lib/use-media-upload'
import { useTranslations } from '../i18n/index'
import PageHeader from '../components/ui/PageHeader'
import PageLoader from '../components/ui/PageLoader'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import Callout from '../components/ui/Callout'
import { FormMessage } from '../components/ui/Field'
import UploadProgress from '../components/ui/UploadProgress'
import { smallestUrl } from '../member/threads/MediaGrid'
import { merchantApi } from './api'

/**
 * A merchant's store (feature 035): the wide cover across the top, a gallery of
 * at most ten photos or videos, a description and opening hours.
 *
 * Name and logo are the organisation's public profile and are edited there.
 * What this page keeps in state is what changes behaviour: the store, the form,
 * a flag while a request runs, and the local checks a person must be told about
 * (a file that is too large, a cover that is not wide). A refusal from the
 * server is logged to the console and not stored, with one exception shown in
 * words — a stale edit, because the person cannot proceed without knowing why.
 */
export function StorePage() {
  const t = useTranslations()
  // undefined = still loading, null = the organisation has no store yet.
  const [store, setStore] = useState<Store | null | undefined>(undefined)
  const [form, setForm] = useState({ description: '', openingHours: '' })
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const cover = useMediaUpload('merchant')
  const gallery = useMediaUpload('merchant')
  const coverInput = useRef<HTMLInputElement>(null)
  const galleryInput = useRef<HTMLInputElement>(null)

  const adopt = (s: Store) => {
    setStore(s)
    setForm({ description: s.description ?? '', openingHours: s.openingHours ?? '' })
  }

  useEffect(() => {
    void merchantApi.store().then(adopt).catch((err) => {
      if (err instanceof ApiError && err.status === 404) { setStore(null); return }
      console.error('StorePage.load', err instanceof ApiError ? err.problem : err)
    })
  }, [])

  const limitText = (check: FileCheck | CoverCheck): string | null => {
    switch (check) {
      case 'ok': return null
      case 'unsupported': return t.merchantStore.limits.unsupported
      case 'image-too-large': return t.merchantStore.limits.imageTooLarge
      case 'video-too-large': return t.merchantStore.limits.videoTooLarge
      case 'not-wide': return t.merchantStore.limits.notWide
      case 'not-an-image': return t.merchantStore.limits.notAnImage
    }
  }

  const run = async (fn: () => Promise<Store>, success: string) => {
    setBusy(true)
    setMessage(null)
    try {
      adopt(await fn())
      setMessage({ tone: 'success', text: success })
    } catch (err) {
      console.error('StorePage.run', err instanceof ApiError ? err.problem : err)
      // A stale edit is the one refusal shown in words: nothing else explains
      // why a save that looked fine did nothing.
      if (err instanceof ApiError && err.status === 409) setMessage({ tone: 'danger', text: t.merchantStore.conflict })
    } finally {
      setBusy(false)
    }
  }

  /** Free a file that no longer belongs to anything. Quiet: a refusal means it is still used. */
  const release = (assetId: string | undefined) => {
    if (assetId) void merchantApi.deleteFile(assetId).catch(() => undefined)
  }

  const chooseCover = async (file: File | undefined) => {
    if (!file || !store) return
    const check = await checkCoverFile(file)
    const text = limitText(check)
    if (text) { setMessage({ tone: 'danger', text }); return }
    setMessage(null)
    const asset = await cover.start(file, fill(t.merchantStore.coverAlt, { name: store.displayName ?? '' }))
    if (!asset) return
    const previous = store.cover?.assetId
    await run(() => merchantApi.setCover(asset.id), t.merchantStore.saved)
    if (previous && previous !== asset.id) release(previous)
  }

  const addToGallery = async (file: File | undefined) => {
    if (!file || !store) return
    const text = limitText(checkMerchantFile(file))
    if (text) { setMessage({ tone: 'danger', text }); return }
    setMessage(null)
    const asset = await gallery.start(file, fill(t.merchantStore.galleryItemAlt, { n: store.media.length + 1, name: store.displayName ?? '' }))
    if (!asset) return
    await run(() => merchantApi.setStoreMedia([...store.media.map((m) => m.assetId), asset.id]), t.merchantStore.saved)
  }

  const removeFromGallery = async (item: MediaItem) => {
    if (!store) return
    await run(() => merchantApi.setStoreMedia(store.media.filter((m) => m.assetId !== item.assetId).map((m) => m.assetId)), t.merchantStore.saved)
    release(item.assetId)
  }

  if (store === undefined) return <PageLoader />

  if (store === null) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t.merchantStore.title} subtitle={t.merchantStore.intro} />
        <Card>
          <p className="mb-4 text-[14px] text-text">{t.merchantStore.noStore}</p>
          <Button loading={busy} onClick={() => run(() => merchantApi.createStore({}), t.merchantStore.created)}>
            {t.merchantStore.create}
          </Button>
        </Card>
      </div>
    )
  }

  const galleryFull = store.media.length >= MAX_STORE_MEDIA

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={store.displayName ?? t.merchantStore.title} subtitle={t.merchantStore.intro} />
      {!store.active && (
        <Callout variant="gold" title={t.merchantStore.deactivatedTitle}>{t.merchantStore.deactivatedBody}</Callout>
      )}
      {message && <FormMessage tone={message.tone}>{message.text}</FormMessage>}

      <Card title={t.merchantStore.cover}>
        {store.cover ? (
          <img
            src={smallestUrl(store.cover, 800)}
            width={store.cover.width}
            height={store.cover.height}
            alt={store.cover.alt}
            className="mb-3 aspect-video w-full rounded-card object-cover"
          />
        ) : (
          <p className="mb-3 text-[13px] text-text-muted">{t.merchantStore.coverHint}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy || cover.state.phase === 'uploading' || cover.state.phase === 'processing'}
            onClick={() => coverInput.current?.click()}>{t.merchantStore.coverChange}</Button>
          {store.cover && (
            <Button variant="quiet" disabled={busy} onClick={() => {
              const previous = store.cover?.assetId
              void run(() => merchantApi.setCover(null), t.merchantStore.saved).then(() => release(previous))
            }}>{t.merchantStore.coverRemove}</Button>
          )}
          <input ref={coverInput} type="file" accept={MERCHANT_IMAGE_TYPES.join(',')} className="sr-only" tabIndex={-1}
            aria-label={t.merchantStore.coverChange} onChange={(e) => { void chooseCover(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div className="mt-3"><UploadProgress state={cover.state} label={t.merchantStore.cover} onCancel={cover.cancel} /></div>
      </Card>

      <Card title={t.merchantStore.title}>
        <label className="mb-3 flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {t.merchantStore.description}
          <textarea value={form.description} maxLength={2000} rows={4} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
        </label>
        <label className="mb-4 flex flex-col gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
          {t.merchantStore.openingHours}
          <textarea value={form.openingHours} maxLength={500} rows={3} onChange={(e) => setForm({ ...form, openingHours: e.target.value })}
            className="rounded-card border border-hairline bg-surface px-3 py-2.5 text-[13px] font-normal normal-case tracking-normal text-text" />
        </label>
        <Button loading={busy} onClick={() => run(() => merchantApi.updateStore({
          version: store.version,
          description: form.description.trim() || null,
          openingHours: form.openingHours.trim() || null,
        }), t.merchantStore.saved)}>{t.merchantStore.save}</Button>
      </Card>

      <Card title={t.merchantStore.gallery}>
        <p className="mb-3 text-[13px] text-text-muted">{fill(t.merchantStore.galleryHint, { max: MAX_STORE_MEDIA })}</p>
        <ul className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
          {store.media.map((item) => (
            <li key={item.assetId} className="flex flex-col gap-1.5">
              <img
                src={smallestUrl(item, 160) || item.posterUrl || ''}
                width={item.width}
                height={item.height}
                alt={item.alt}
                className="aspect-[4/3] w-full rounded-card object-cover"
              />
              <Button variant="quiet" disabled={busy} onClick={() => void removeFromGallery(item)}>{t.merchantStore.galleryRemove}</Button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={busy || galleryFull || gallery.state.phase === 'uploading' || gallery.state.phase === 'processing'}
            onClick={() => galleryInput.current?.click()}>{t.merchantStore.galleryAdd}</Button>
          {galleryFull && <span className="text-[12px] text-text-muted">{fill(t.merchantStore.galleryFull, { max: MAX_STORE_MEDIA })}</span>}
          <input ref={galleryInput} type="file" accept={MERCHANT_MEDIA_TYPES.join(',')} className="sr-only" tabIndex={-1}
            aria-label={t.merchantStore.galleryAdd} onChange={(e) => { void addToGallery(e.target.files?.[0]); e.target.value = '' }} />
        </div>
        <div className="mt-3"><UploadProgress state={gallery.state} label={t.merchantStore.gallery} onCancel={gallery.cancel} /></div>
      </Card>
    </div>
  )
}

export default StorePage
