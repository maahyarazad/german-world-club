import { MERCHANT_IMAGE_MAX_BYTES, MERCHANT_VIDEO_MAX_BYTES, isWideCover } from '@gwc/contracts/media'

/**
 * What a merchant may upload, checked BEFORE sending (feature 035, research R15).
 *
 * The server decides — it inspects the bytes, not the declared type — and these
 * checks exist so a person learns the limit before waiting on a large upload
 * rather than after. The numbers and the wide-cover rule come from
 * `@gwc/contracts/media`, so the web, the app and the server cannot disagree.
 */

export const MERCHANT_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
export const MERCHANT_VIDEO_TYPES = Object.freeze(['video/mp4', 'video/webm', 'video/quicktime'])
export const MERCHANT_MEDIA_TYPES = Object.freeze([...MERCHANT_IMAGE_TYPES, ...MERCHANT_VIDEO_TYPES])

export type FileCheck = 'ok' | 'unsupported' | 'image-too-large' | 'video-too-large'
export type CoverCheck = FileCheck | 'not-an-image' | 'not-wide'

type FileLike = { type: string; size: number }

/** At or above the limit is refused: "under 1 MB" and "under 5 MB". */
export function checkMerchantFile(file: FileLike): FileCheck {
  if (MERCHANT_IMAGE_TYPES.includes(file.type)) {
    return file.size >= MERCHANT_IMAGE_MAX_BYTES ? 'image-too-large' : 'ok'
  }
  if (MERCHANT_VIDEO_TYPES.includes(file.type)) {
    return file.size >= MERCHANT_VIDEO_MAX_BYTES ? 'video-too-large' : 'ok'
  }
  return 'unsupported'
}

/** The width and height of an image file, or null when the browser cannot read it. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close?.()
    return size
  } catch {
    return null
  }
}

/**
 * A cover must be an image, under the photo limit, and wide (about 16:9). When
 * the browser cannot read the dimensions the file is let through: the server
 * checks the real ones and refuses a wrong shape, leaving the old cover.
 */
export async function checkCoverFile(
  file: FileLike & Blob,
  readSize: (file: Blob) => Promise<{ width: number; height: number } | null> = readImageSize,
): Promise<CoverCheck> {
  const basic = checkMerchantFile(file)
  if (basic !== 'ok') return basic
  if (!MERCHANT_IMAGE_TYPES.includes(file.type)) return 'not-an-image'
  const size = await readSize(file)
  if (size && !isWideCover(size.width, size.height)) return 'not-wide'
  return 'ok'
}
