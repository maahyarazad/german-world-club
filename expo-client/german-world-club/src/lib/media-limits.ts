import { MERCHANT_IMAGE_MAX_BYTES, MERCHANT_VIDEO_MAX_BYTES, isWideCover } from '@gwc/contracts/media';

import type { Picked } from '@/lib/pick-media';

/**
 * What a merchant may upload, checked before sending (feature 035, research R15).
 * The numbers and the wide-cover rule come from `@gwc/contracts/media`, so the
 * app, the web console and the server cannot disagree; the server still decides,
 * from the bytes. A file at or above its limit is refused ("under 1 MB").
 *
 * The library does not always report a size. A missing one is let through: the
 * server answers `media-too-large` and the screen says so.
 */
export type LimitCheck = 'ok' | 'image-too-large' | 'video-too-large' | 'not-an-image' | 'not-wide';

export function checkPicked(item: Picked, { cover = false }: { cover?: boolean } = {}): LimitCheck {
  if (cover && item.kind !== 'image') return 'not-an-image';
  if (item.size !== undefined) {
    if (item.kind === 'image' && item.size >= MERCHANT_IMAGE_MAX_BYTES) return 'image-too-large';
    if (item.kind === 'video' && item.size >= MERCHANT_VIDEO_MAX_BYTES) return 'video-too-large';
  }
  if (cover && item.width && item.height && !isWideCover(item.width, item.height)) return 'not-wide';
  return 'ok';
}
