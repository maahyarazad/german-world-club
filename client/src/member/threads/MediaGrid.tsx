import { useState } from 'react'
import type { MediaItem } from '@gwc/contracts/media'
import { useTranslations } from '../../i18n/index'

/**
 * A post's photos and videos (feature 010, US1).
 *
 * One item fills the width, two to four sit in a grid, five to ten scroll
 * sideways — the layout Threads uses. Every element carries the source's
 * width and height, so the feed does not shift as media decodes (§10.9).
 * Only derivatives are ever referenced: the server sends nothing else.
 *
 * A video shows its poster until the member presses play, and then plays
 * MUTED: nothing in a feed starts making sound on its own (FR-004).
 */

export function srcSetOf(item: MediaItem) {
  return item.variants
    .filter((v) => v.format !== 'webm')
    .map((v) => `${v.url} ${v.width}w`)
    .join(', ')
}

export function smallestUrl(item: MediaItem, atLeast = 0) {
  const images = item.variants.filter((v) => v.format !== 'webm')
  return (images.find((v) => v.width >= atLeast) ?? images[images.length - 1])?.url ?? item.posterUrl ?? ''
}

function VideoItem({ item, className }: { item: MediaItem; className: string }) {
  const t = useTranslations()
  const [playing, setPlaying] = useState(false)
  const source = item.variants.find((v) => v.variant === 'video')
  if (playing && source) {
    return (
      <video
        src={source.url}
        poster={item.posterUrl ?? undefined}
        width={item.width}
        height={item.height}
        muted
        autoPlay
        controls
        playsInline
        className={className}
      />
    )
  }
  return (
    <button type="button" onClick={() => setPlaying(true)} className={`relative ${className}`} aria-label={t.memberThreads.playVideo}>
      {item.posterUrl && (
        <img src={item.posterUrl} alt={item.alt} width={item.width} height={item.height} className="h-full w-full object-cover" loading="lazy" />
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-ink/70 px-3 py-1 text-[18px] text-text-on-dark" aria-hidden>▶</span>
      </span>
    </button>
  )
}

function Item({ item, className, sizes }: { item: MediaItem; className: string; sizes: string }) {
  if (item.kind === 'video') return <VideoItem item={item} className={className} />
  return (
    <img
      src={smallestUrl(item, 800)}
      srcSet={srcSetOf(item)}
      sizes={sizes}
      alt={item.alt}
      width={item.width}
      height={item.height}
      loading="lazy"
      className={className}
    />
  )
}

export function MediaGrid({ media }: { media: readonly MediaItem[] }) {
  if (media.length === 0) return null
  const cell = 'h-full w-full overflow-hidden rounded-card bg-ground object-cover'

  if (media.length === 1) {
    const item = media[0]!
    return (
      <div className="mt-2 overflow-hidden rounded-card" style={{ aspectRatio: `${item.width} / ${item.height}`, maxHeight: 520 }}>
        <Item item={item} className={cell} sizes="(min-width: 768px) 560px, 100vw" />
      </div>
    )
  }
  if (media.length <= 4) {
    return (
      <div className="mt-2 grid grid-cols-2 gap-1">
        {media.map((item) => (
          <div key={item.assetId} className="aspect-square">
            <Item item={item} className={cell} sizes="(min-width: 768px) 280px, 50vw" />
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="mt-2 flex snap-x snap-mandatory gap-1 overflow-x-auto pb-1">
      {media.map((item) => (
        <div key={item.assetId} className="aspect-[4/5] w-56 shrink-0 snap-start">
          <Item item={item} className={cell} sizes="224px" />
        </div>
      ))}
    </div>
  )
}

export default MediaGrid
