import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { MEDIA_MAX_BYTES } from '@gwc/contracts/media'
import Button from '../components/ui/Button'
import Field from '../components/ui/Field'
import StatusPill from '../components/ui/StatusPill'
import type { StatusTone } from '../components/ui/StatusPill'
import { useTranslations } from '../i18n/index'

/**
 * Choosing the photos and video for a listing, before it is published.
 *
 * A visible control rather than a bare `<input type="file">`: Tailwind's
 * preflight strips the native "choose file" button down to unstyled text, so
 * the bare input rendered as a label with nothing apparently clickable, and
 * members reported that there was no way to upload at all.
 *
 * Nothing is uploaded here. The files are held, with a preview and the
 * description the server requires (§10.1), until the listing exists — the
 * attach route needs its id — and `Marketplace.tsx` then uploads them in the
 * order shown, because the first one represents the listing in the index.
 */

/** What the upload pipeline accepts (server/src/modules/media/validate.ts). */
export const MEDIA_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/avif',
  'video/mp4', 'video/webm', 'video/quicktime',
])

/** data-model.md §5; also a CHECK constraint on marketplace_listing_media. */
export const MAX_MEDIA_PER_LISTING = 20

export type MediaStatus = 'pending' | 'uploading' | 'processing' | 'attached' | 'failed'

export type PendingMedia = {
  key: string
  file: File
  alt: string
  /** An object URL for the preview; revoked when the item goes. */
  preview: string
  status?: MediaStatus
}

const STATUS_TONE: Record<MediaStatus, StatusTone> = {
  pending: 'neutral',
  uploading: 'pending',
  processing: 'pending',
  attached: 'success',
  failed: 'danger',
}

let counter = 0

export function MediaPicker({ items, onChange, onError, disabled = false }: {
  items: readonly PendingMedia[]
  onChange: (items: PendingMedia[]) => void
  onError: (message: string | null) => void
  disabled?: boolean
}) {
  const t = useTranslations()
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  // Object URLs hold the file in memory until revoked. Revoke what is no
  // longer listed, and everything when the form goes away.
  const live = useRef(new Set<string>())
  useEffect(() => {
    const current = new Set(items.map((i) => i.preview))
    for (const url of live.current) if (!current.has(url)) URL.revokeObjectURL(url)
    live.current = current
  }, [items])
  useEffect(() => () => { for (const url of live.current) URL.revokeObjectURL(url) }, [])

  const add = (files: FileList | File[] | null) => {
    if (!files) return
    const picked = [...files]
    if (picked.length === 0) return
    // The server decides from the bytes (FR-052); this only spares a member
    // an upload that is certain to be refused.
    if (picked.some((f) => !MEDIA_TYPES.includes(f.type))) return onError(t.memberMarketplace.mediaUnsupported)
    if (picked.some((f) => f.size > MEDIA_MAX_BYTES)) return onError(t.memberMarketplace.mediaTooLarge)
    if (items.length + picked.length > MAX_MEDIA_PER_LISTING) return onError(t.memberMarketplace.mediaTooMany)
    onError(null)
    onChange([
      ...items,
      ...picked.map((file) => ({
        key: `media-${(counter += 1)}`,
        file,
        alt: '',
        preview: URL.createObjectURL(file),
      })),
    ])
  }

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return
    const next = [...items]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item!)
    onChange(next)
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragging(false)
    if (!disabled) add(event.dataTransfer.files)
  }

  const full = items.length >= MAX_MEDIA_PER_LISTING

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
        {t.memberMarketplace.media}
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !full) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center ${
          dragging ? 'border-navy bg-tint-info' : 'border-hairline bg-ground'
        }`}
      >
        <p className="text-[13px] text-text">{t.memberMarketplace.mediaDrop}</p>
        <Button variant="secondary" disabled={disabled || full} onClick={() => input.current?.click()}>
          {t.memberMarketplace.mediaChoose}
        </Button>
        <p className="text-[11px] text-text-muted">{t.memberMarketplace.mediaHint}</p>
        <input
          ref={input}
          type="file"
          multiple
          accept={MEDIA_TYPES.join(',')}
          aria-label={t.memberMarketplace.media}
          className="sr-only"
          tabIndex={-1}
          disabled={disabled || full}
          onChange={(e) => { add(e.target.files); e.target.value = '' }}
        />
      </div>

      {items.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item, index) => {
            const video = item.file.type.startsWith('video/')
            return (
              <li key={item.key} className="flex flex-col gap-2 rounded-card border border-hairline bg-surface p-3">
                <div className="relative overflow-hidden rounded-card bg-ground">
                  {/* Explicit dimensions and a fixed ratio, so the grid does
                      not shift as previews decode (§10.9). */}
                  {video ? (
                    <video
                      src={item.preview}
                      muted
                      preload="metadata"
                      width={400}
                      height={300}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  ) : (
                    <img
                      src={item.preview}
                      alt={item.alt}
                      width={400}
                      height={300}
                      className="aspect-[4/3] w-full object-cover"
                    />
                  )}
                  <div className="absolute left-2 top-2 flex gap-1">
                    {index === 0 && <StatusPill tone="info">{t.memberMarketplace.mediaCover}</StatusPill>}
                    {item.status && (
                      <StatusPill tone={STATUS_TONE[item.status]}>{t.memberMarketplace.mediaStatus[item.status]}</StatusPill>
                    )}
                  </div>
                </div>

                <p className="truncate text-[12px] text-text-muted" title={item.file.name}>{item.file.name}</p>

                <Field
                  label={t.memberMarketplace.mediaAlt}
                  value={item.alt}
                  disabled={disabled}
                  onChange={(e) => {
                    const alt = e.target.value
                    onChange(items.map((m) => (m.key === item.key ? { ...m, alt } : m)))
                  }}
                />

                <div className="flex flex-wrap gap-2">
                  {index > 0 && (
                    <Button variant="quiet" disabled={disabled} onClick={() => move(index, 0)}>
                      {t.memberMarketplace.mediaMakeCover}
                    </Button>
                  )}
                  <Button variant="quiet" disabled={disabled || index === 0} onClick={() => move(index, index - 1)}>
                    {t.memberMarketplace.mediaMoveEarlier}
                  </Button>
                  <Button variant="quiet" disabled={disabled || index === items.length - 1} onClick={() => move(index, index + 1)}>
                    {t.memberMarketplace.mediaMoveLater}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    onClick={() => onChange(items.filter((m) => m.key !== item.key))}
                  >
                    {t.memberMarketplace.mediaRemove}
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default MediaPicker
