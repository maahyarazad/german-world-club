import { useState } from 'react'
import type { MediaItem } from '@gwc/contracts/media'
import { useTranslations } from '../i18n/index'
import { smallestUrl } from '../member/threads/MediaGrid'
import { OFFER_FALLBACK, OFFER_FRAME_ATTR, OFFER_FRAME_STYLE } from './frame'

/**
 * An offer's picture in the club's 16:9 frame (feature 042, US2).
 *
 * `item` is what the server sent: `null` (a list) or no item (a detail) means the
 * offer has no usable media, and the server says so on purpose rather than
 * sending a stand-in (Principle III). What to draw instead is this component's
 * only decision: the club's bundled fallback, in the same frame, so a list of
 * offers looks complete and a merchant who has uploaded nothing is not
 * misrepresented anywhere an editor reads the media list.
 *
 * A picture that fails to load (a purged derivative, a dropped connection) gets
 * the fallback as well, instead of an empty box. The failure is remembered per
 * asset, so the next offer in a recycled card is tried afresh.
 */
export function OfferPicture({
  item, maxWidth = 640, className = '', eager = false,
}: {
  item: MediaItem | null | undefined
  /** The smallest variant at least this wide is used. */
  maxWidth?: number
  className?: string
  eager?: boolean
}) {
  const t = useTranslations()
  const [failedAsset, setFailedAsset] = useState<string | null>(null)

  const src = item ? smallestUrl(item, maxWidth) || item.posterUrl || '' : ''
  const usable = Boolean(item && src && failedAsset !== item.assetId)

  return (
    <div
      data-aspect={OFFER_FRAME_ATTR}
      style={OFFER_FRAME_STYLE}
      className={`w-full overflow-hidden rounded-card bg-surface ${className}`.trim()}
    >
      {usable && item ? (
        <img
          src={src}
          width={item.width}
          height={item.height}
          alt={item.alt}
          loading={eager ? 'eager' : 'lazy'}
          onError={() => setFailedAsset(item.assetId)}
          className="h-full w-full object-cover"
        />
      ) : (
        <img
          src={OFFER_FALLBACK.src}
          width={OFFER_FALLBACK.width}
          height={OFFER_FALLBACK.height}
          alt={t.clubOffers.fallbackAlt}
          loading={eager ? 'eager' : 'lazy'}
          className="h-full w-full object-cover"
        />
      )}
    </div>
  )
}

export default OfferPicture
