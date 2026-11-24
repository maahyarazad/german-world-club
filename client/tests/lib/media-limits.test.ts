import { describe, it, expect } from 'vitest'
import { MERCHANT_IMAGE_MAX_BYTES, MERCHANT_VIDEO_MAX_BYTES } from '@gwc/contracts/media'
import { checkMerchantFile, checkCoverFile } from '../../src/lib/media-limits'

/**
 * What a merchant may upload, checked before sending (feature 035). The numbers
 * come from the shared contract; these pin the boundary — a file AT the limit is
 * refused ("under 1 MB", "under 5 MB") — and that the cover must be wide.
 */
describe('checkMerchantFile', () => {
  it('accepts a photo one byte under 1 MiB and refuses one at it', () => {
    expect(checkMerchantFile({ type: 'image/jpeg', size: MERCHANT_IMAGE_MAX_BYTES - 1 })).toBe('ok')
    expect(checkMerchantFile({ type: 'image/jpeg', size: MERCHANT_IMAGE_MAX_BYTES })).toBe('image-too-large')
  })

  it('accepts a video one byte under 5 MiB and refuses one at it', () => {
    expect(checkMerchantFile({ type: 'video/mp4', size: MERCHANT_VIDEO_MAX_BYTES - 1 })).toBe('ok')
    expect(checkMerchantFile({ type: 'video/mp4', size: MERCHANT_VIDEO_MAX_BYTES })).toBe('video-too-large')
  })

  it('holds the two kinds to different limits — the counter-assertion', () => {
    // 2 MB is far over a photo's limit and well under a video's.
    expect(checkMerchantFile({ type: 'image/png', size: 2_000_000 })).toBe('image-too-large')
    expect(checkMerchantFile({ type: 'video/webm', size: 2_000_000 })).toBe('ok')
  })

  it('refuses a type the pipeline does not take', () => {
    expect(checkMerchantFile({ type: 'application/pdf', size: 1000 })).toBe('unsupported')
    expect(checkMerchantFile({ type: '', size: 1000 })).toBe('unsupported')
  })
})

describe('checkCoverFile', () => {
  const photo = (size = 200_000, type = 'image/jpeg') => new File([new Uint8Array(1)], 'c.jpg', { type }) as File & { size: number } & Blob
  const sized = (width: number, height: number) => async () => ({ width, height })

  it('accepts a wide image', async () => {
    expect(await checkCoverFile(photo(), sized(1600, 900))).toBe('ok')
    expect(await checkCoverFile(photo(), sized(1280, 720))).toBe('ok')
  })

  it.each([[800, 800], [900, 1600], [1200, 900]])('refuses a %i x %i image as not wide', async (w, h) => {
    expect(await checkCoverFile(photo(), sized(w, h))).toBe('not-wide')
  })

  it('refuses a video as a cover', async () => {
    expect(await checkCoverFile(photo(1000, 'video/mp4'), sized(1920, 1080))).toBe('not-an-image')
  })

  it('lets a file through when the browser cannot read its size: the server decides', async () => {
    expect(await checkCoverFile(photo(), async () => null)).toBe('ok')
  })
})
