import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { MediaItem } from '@gwc/contracts/media'
import { useTranslations } from '../i18n/index'
import { OfferPicture } from './OfferPicture'
import { OFFER_FRAME_ATTR, OFFER_FRAME_STYLE } from './frame'
import arrowLeft from './arrow-left-1-svgrepo-com.svg'
import arrowRight from './arrow-right-1-svgrepo-com.svg'

/**
 * An offer's images and videos, one 16:9 slide at a time (feature 042, US1).
 *
 * Paging is the browser's own: a scroll-snap track gives touch and trackpad
 * swipes with native momentum for free, and previous/next buttons, dots and the
 * arrow keys cover mouse and keyboard. There is no carousel library to ship and no
 * hand-written gesture code to get wrong. Under a reduced-motion preference the
 * scrolling is not animated.
 *
 * Which slide is current is set at once when the person pages (so the buttons and
 * dots answer instantly) and read from the scroll position when they swipe.
 *
 * No media means the club's fallback in the same frame and no controls: the
 * server's `[]` is what an editor sees, this is what a member sees (research R1).
 * One item means no dots and no buttons. A video shows its still picture and plays
 * muted only when asked, and leaving its slide stops it.
 *
 * `renderAction` is a slot for the current item (the super admin's "Make main"):
 * the gallery draws it and knows nothing about roles.
 */

const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function OfferGallery({
  media, renderAction,
}: {
  media: readonly MediaItem[]
  renderAction?: (item: MediaItem, index: number) => ReactNode
}) {
  const t = useTranslations()
  const track = useRef<HTMLDivElement>(null)
  const frame = useRef(0)
  const currentRef = useRef(0)
  const [current, setCurrentState] = useState(0)
  const [playing, setPlaying] = useState<string | null>(null)

  /** Moving to another slide is leaving the one before: a playing video stops. */
  const setCurrent = useCallback((index: number) => {
    if (index === currentRef.current) return
    currentRef.current = index
    setCurrentState(index)
    setPlaying(null)
  }, [])

  const total = media.length
  const goTo = (index: number) => {
    const next = Math.max(0, Math.min(total - 1, index))
    setCurrent(next)
    const el = track.current
    // jsdom has no `scrollTo`; a real browser always does.
    el?.scrollTo?.({ left: next * el.clientWidth, behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  // A swipe: read the slide from the scroll position, once per frame.
  const onScroll = () => {
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const el = track.current
      if (!el || el.clientWidth === 0) return
      setCurrent(Math.max(0, Math.min(total - 1, Math.round(el.scrollLeft / el.clientWidth))))
    })
  }
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current) }, [])

  // The first item changed (the main one was chosen): show it.
  const firstAsset = media[0]?.assetId
  const seenFirst = useRef(firstAsset)
  useEffect(() => {
    if (seenFirst.current === firstAsset) return
    seenFirst.current = firstAsset
    currentRef.current = 0
    setCurrentState(0)
    setPlaying(null)
    track.current?.scrollTo?.({ left: 0, behavior: 'auto' })
  }, [firstAsset])

  if (total === 0) return <OfferPicture item={null} eager />

  const label = (n: number) => t.clubOffers.gallery.slide.replace('{n}', String(n)).replace('{total}', String(total))
  const paged = total > 1
  const item = media[Math.min(current, total - 1)]!

  return (
    <div>
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label={t.clubOffers.gallery.region}
        data-aspect={OFFER_FRAME_ATTR}
        className="relative overflow-hidden rounded-card bg-surface"
      >
        <div
          ref={track}
          data-testid="offer-gallery-track"
          tabIndex={paged ? 0 : undefined}
          onScroll={onScroll}
          onKeyDown={(e) => {
            if (!paged) return
            if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current + 1) }
            if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current - 1) }
          }}
          style={OFFER_FRAME_STYLE}
          className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth motion-reduce:scroll-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden focus-visible:outline-2 focus-visible:outline-navy"
        >
          {media.map((m, i) => {
            const source = m.kind === 'video' ? m.variants.find((v) => v.variant === 'video') : undefined
            const isPlaying = playing === m.assetId && i === current && Boolean(source)
            return (
              <div
                key={m.assetId}
                role="group"
                aria-roledescription="slide"
                aria-label={label(i + 1)}
                className="relative w-full shrink-0 basis-full snap-center"
              >
                {isPlaying && source ? (
                  <video
                    src={source.url}
                    poster={m.posterUrl ?? undefined}
                    muted
                    autoPlay
                    controls
                    playsInline
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <>
                    <OfferPicture item={m} maxWidth={1200} eager={i === 0} className="rounded-none" />
                    {source && (
                      <button
                        type="button"
                        aria-label={t.clubOffers.gallery.play}
                        onClick={() => setPlaying(m.assetId)}
                        className="absolute inset-0 flex items-center justify-center"
                      >
                        <span className="rounded-full bg-ink/70 px-3 py-1 text-[18px] text-text-on-dark" aria-hidden>▶</span>
                      </button>
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {paged && (
          <>
            <button
              type="button"
              aria-label={t.clubOffers.gallery.previous}
              disabled={current === 0}
              onClick={() => goTo(current - 1)}
              className="absolute left-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-text-on-dark/40 bg-ink/60 text-text-on-dark shadow-md enabled:hover:bg-ink/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              <img src={arrowLeft} alt="" aria-hidden draggable={false} className="h-9 w-9 select-none" />
            </button>
            <button
              type="button"
              aria-label={t.clubOffers.gallery.next}
              disabled={current === total - 1}
              onClick={() => goTo(current + 1)}
              className="absolute right-2 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full border border-text-on-dark/40 bg-ink/60 text-text-on-dark shadow-md enabled:hover:bg-ink/80 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
            >
              <img src={arrowRight} alt="" aria-hidden draggable={false} className="h-9 w-9 select-none" />
            </button>
          </>
        )}
      </div>

      {paged && (
        <div className="mt-2 flex justify-center gap-1">
          {media.map((m, i) => (
            <button
              key={m.assetId}
              type="button"
              aria-label={label(i + 1)}
              aria-current={i === current ? 'true' : undefined}
              onClick={() => goTo(i)}
              className="p-1"
            >
              <span className={`block h-2.5 w-2.5 rounded-full ${i === current ? 'bg-navy' : 'bg-hairline'}`} aria-hidden />
            </button>
          ))}
        </div>
      )}
      {paged && <p className="sr-only" aria-live="polite">{label(current + 1)}</p>}

      {renderAction && <div className="mt-2">{renderAction(item, Math.min(current, total - 1))}</div>}
    </div>
  )
}

export default OfferGallery
