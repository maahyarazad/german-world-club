import sharp from 'sharp'
import { applyFormat } from './strip-metadata.ts'

/**
 * Image derivatives (FR-056, FR-057, FR-061; media-pipeline.md §5).
 *
 * Runs synchronously inside the 8 s `media-upload` budget. A 2 MB photograph
 * through `sharp` is roughly 200–600 ms for the whole set, so it fits, and the
 * upload response can carry every variant URL rather than making the client
 * poll for them.
 */

/** Width caps. Height follows from the aspect ratio, which is never altered. */
export const BREAKPOINTS = Object.freeze([
  { variant: 'thumb', width: 160 },
  { variant: 'small', width: 400 },
  { variant: 'medium', width: 800 },
  { variant: 'large', width: 1600 },
])

/**
 * Per-variant quality.
 *
 * A thumbnail is displayed at a fraction of its size, so it tolerates
 * aggressive compression that would be visible at 1600 px. Flat quality across
 * the set is what makes a thumbnail cost 30 KB when it should cost 4 — and
 * SC-019 asks for `thumb` ≤ 8 KB from a 2 MB source.
 */
const QUALITY = Object.freeze({ thumb: 62, small: 70, medium: 76, large: 80 })

/**
 * The fallback format for sources a browser cannot take as WebP.
 *
 * PNG **only** when the source has an alpha channel; JPEG otherwise. PNG for
 * photographic content runs 5–10× larger than either alternative, so defaulting
 * to it would defeat the point of the pipeline — the club would ship megabytes
 * to phones in the name of a fallback almost nothing uses.
 */
export const fallbackFormatFor = (hasAlpha) => (hasAlpha ? 'png' : 'jpeg')

/**
 * Which breakpoints a source of this width should produce.
 *
 * Never upscaled (FR-056). Generating a 1600 px derivative from a 300 px
 * original adds bytes and no information, and makes the `srcset` lie to the
 * browser about what it is choosing between.
 *
 * But "don't upscale" is not the same as "stop early". Every breakpoint that
 * fits is produced, and then the next one up is produced **clamped to the
 * source width** — so a 300 px source yields `thumb` at 160 and `small` at 300,
 * which is what media-pipeline.md §5 describes. That clamped variant is the
 * full-size delivery copy; without it a 300 px image would have nothing above
 * 160 px to offer and the page would be pushed back to the original, which
 * FR-060 forbids delivering.
 *
 * The clamped variant is skipped when a breakpoint already lands exactly on the
 * source width, since it would be a byte-identical duplicate.
 */
export function breakpointsFor(sourceWidth) {
  const fitting = BREAKPOINTS.filter((b) => b.width <= sourceWidth)
  const largestFitting = fitting.at(-1)

  if (largestFitting?.width === sourceWidth) return fitting

  const nextUp = BREAKPOINTS.find((b) => b.width > sourceWidth)
  if (!nextUp) return fitting

  return [...fitting, { variant: nextUp.variant, width: sourceWidth }]
}

/**
 * Produce every derivative for one image.
 *
 * @param buffer the stripped original
 * @param options.limitInputPixels the decode-time bomb bound (FR-053)
 * @returns {Promise<{source: {width, height, hasAlpha}, variants: Array<{variant, format, width, height, bytes, buffer}>}>}
 */
export async function deriveImage(buffer, { limitInputPixels, primaryFormat = 'webp' } = {}) {
  const meta = await sharp(buffer, { limitInputPixels, failOn: 'error' }).metadata()
  const hasAlpha = Boolean(meta.hasAlpha)
  const fallback = fallbackFormatFor(hasAlpha)

  const wanted = breakpointsFor(meta.width)
  const variants = []

  for (const { variant, width } of wanted) {
    // WebP primary, plus the one fallback. Both formats at each breakpoint, so
    // `<picture>` can offer a real choice rather than a WebP-or-original one.
    for (const format of [primaryFormat, fallback]) {
      const pipeline = sharp(buffer, { limitInputPixels, failOn: 'error' }).resize({
        width,
        // `withoutEnlargement` is the belt to `breakpointsFor`'s braces: even if
        // a caller asked for a width above the source, the output is clamped
        // rather than upscaled.
        withoutEnlargement: true,
        fit: 'inside',
      })

      const output = await applyFormat(pipeline, format, { quality: QUALITY[variant] ?? 80 })
        .toBuffer({ resolveWithObject: true })

      variants.push({
        variant,
        format: output.info.format === 'jpg' ? 'jpeg' : output.info.format,
        width: output.info.width,
        height: output.info.height,
        bytes: output.data.length,
        buffer: output.data,
      })
    }
  }

  return {
    source: { width: meta.width, height: meta.height, hasAlpha },
    variants,
  }
}

/**
 * Probe intrinsic dimensions without deriving anything (FR-055).
 *
 * Runs synchronously for video too, because §10.9's layout-shift requirement
 * needs width and height at first render and cannot wait for a transcode.
 */
export async function probeDimensions(buffer, { limitInputPixels } = {}) {
  const meta = await sharp(buffer, { limitInputPixels, failOn: 'error' }).metadata()
  return { width: meta.width, height: meta.height, hasAlpha: Boolean(meta.hasAlpha), format: meta.format }
}
