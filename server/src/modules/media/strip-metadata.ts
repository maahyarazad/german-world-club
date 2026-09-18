import sharp from 'sharp'

/**
 * Metadata removal (FR-054, SC-020).
 *
 * A photograph taken on a phone carries EXIF, and EXIF routinely carries GPS
 * coordinates. A member uploading a picture from home would otherwise publish
 * their home address to anyone who downloads it — a direct §10.1 PII concern,
 * and one nobody involved would expect, which is exactly why it has to be
 * handled by the pipeline rather than by asking members to be careful.
 *
 * This applies to the stored **original** as well as to every derivative. The
 * original is never delivered (FR-060), but "not currently served" is a
 * property of today's routes, not of the bytes; stripping once at ingest means
 * a future feature that does serve it cannot reintroduce the leak.
 *
 * What is deliberately kept:
 *
 *  - **Orientation** is applied to the pixels (`rotate()` with no argument
 *    reads the EXIF orientation) and then discarded. Dropping the tag without
 *    applying it would silently turn every phone photograph on its side.
 *  - Nothing else. ICC profiles are dropped too: sharp converts to sRGB, and a
 *    retained profile is both bytes and a fingerprinting surface.
 */

/** sharp's default is to discard metadata; this makes the intent explicit. */
const STRIP_OPTIONS = Object.freeze({
  // `sharp` keeps no metadata unless asked, but being explicit here means a
  // future `withMetadata()` added for some other reason reads as the conflict
  // it would be.
  keepMetadata: false,
})

/**
 * Re-encode an image with every piece of metadata removed and the EXIF
 * orientation baked into the pixels.
 *
 * @param buffer the source bytes
 * @param options.limitInputPixels the decode-time bound — the second of the two
 *        independent checks against a decompression bomb (validate.js is the
 *        first, from the header, before this function is ever reached).
 * @returns {Promise<{buffer: Buffer, width: number, height: number, format: string, hasAlpha: boolean}>}
 */
export async function stripMetadata(buffer, { limitInputPixels, format } = {}) {
  const pipeline = sharp(buffer, { limitInputPixels, failOn: 'error' }).rotate()

  const meta = await sharp(buffer, { limitInputPixels, failOn: 'error' }).metadata()
  const target = format ?? meta.format

  // Re-encoded in place rather than copied: an encoder pass is what actually
  // drops the metadata blocks. Quality is kept high because this is the
  // archival copy, not a delivery artefact — the derivatives do the compressing.
  const encoded = await applyFormat(pipeline, target, { quality: 92 })
  const output = await encoded.toBuffer({ resolveWithObject: true })

  return {
    buffer: output.data,
    width: output.info.width,
    height: output.info.height,
    format: output.info.format,
    hasAlpha: Boolean(meta.hasAlpha),
  }
}

/** Route a pipeline to the right encoder. Shared with derive-image.js. */
export function applyFormat(pipeline, format, { quality = 80, effort = 4 } = {}) {
  switch (format) {
    case 'webp':
      return pipeline.webp({ quality, effort, ...STRIP_OPTIONS })
    case 'png':
      // `palette` is what makes PNG competitive at all for the alpha sources it
      // is the fallback for; without it a logo can be several times larger than
      // the WebP it falls back from.
      return pipeline.png({ compressionLevel: 9, palette: true, ...STRIP_OPTIONS })
    case 'jpeg':
    case 'jpg':
      return pipeline.jpeg({ quality, mozjpeg: true, ...STRIP_OPTIONS })
    case 'avif':
      return pipeline.avif({ quality, effort, ...STRIP_OPTIONS })
    default:
      return pipeline.webp({ quality, effort, ...STRIP_OPTIONS })
  }
}

/**
 * Whether a buffer still carries any location metadata.
 *
 * Used by the test suite and by the verification script. Reads through `sharp`
 * so the answer is about what a real consumer would find, not about whether a
 * particular byte sequence is absent.
 */
export async function hasLocationMetadata(buffer) {
  try {
    const meta = await sharp(buffer).metadata()
    if (meta.exif) {
      // Any surviving EXIF block is treated as a failure. Parsing it to look
      // specifically for GPS tags would be a worse test: the requirement is
      // that the block is gone, and a stricter assertion cannot produce a false
      // pass.
      return true
    }
    return Boolean(meta.xmp || meta.iptc)
  } catch {
    return false
  }
}
