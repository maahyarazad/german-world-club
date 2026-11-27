import { OFFER_MEDIA_ASPECT } from '@gwc/contracts/offers'
import fallbackUrl from '../assets/offer-fallback.webp'

/**
 * What every picture of a merchant offer on the web shares (feature 042).
 *
 * The 16:9 frame comes from the contract, so the web and the app cannot disagree
 * about it (FR-030). Tailwind's `aspect-video` happens to be the same number, but
 * it would be a second definition, which is what the contract exists to prevent.
 */
export const OFFER_FRAME_STYLE = {
  aspectRatio: `${OFFER_MEDIA_ASPECT.width} / ${OFFER_MEDIA_ASPECT.height}`,
} as const

/** `data-aspect` value on a frame; lets a test (jsdom has no layout) and a reader see the ratio. */
export const OFFER_FRAME_ATTR = `${OFFER_MEDIA_ASPECT.width}/${OFFER_MEDIA_ASPECT.height}`

/**
 * The club's fallback image, bundled with the web client and hashed by Vite, so it is
 * served same-origin (the CSP allows `img-src 'self'`). Its real size is declared on
 * every `<img>` so the page does not shift as it decodes (Principle VI).
 */
export const OFFER_FALLBACK = { src: fallbackUrl, width: 1672, height: 941 } as const
