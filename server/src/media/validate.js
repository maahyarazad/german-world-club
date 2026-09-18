import { fileTypeFromBuffer } from 'file-type'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * Upload validation, in the order media-pipeline.md §4 specifies (FR-052,
 * FR-053).
 *
 * The order is the design. Each step is cheaper than the next and refuses a
 * malicious file before the expensive one runs, so an attacker cannot make the
 * server do real work by sending something obviously wrong.
 *
 *   1. byte cap, enforced while streaming — never buffer 25 MB to find out
 *   2. magic bytes decide the type; filename and Content-Type are ignored
 *   3. the type is on the allowlist
 *   4. declared dimensions checked from the HEADER, before any decode
 *   5. (quota — the caller's transaction, see routes.js)
 *   6. (metadata strip — strip-metadata.js)
 *
 * Step 4 is the one that is easy to skip and expensive to miss. A 10 KB PNG can
 * declare 100,000 × 100,000 pixels, which decodes to tens of gigabytes. Reading
 * the bound from the header first is what makes an upload endpoint safe to
 * expose at all; `sharp`'s `limitInputPixels` then enforces it a second time at
 * decode, because two independent checks are what you want on the one step
 * whose failure mode is the process dying.
 */

/** Refusals carry a problem so the route layer does not re-derive the mapping. */
export class MediaRejected extends Error {
  constructor(problem, detail, extra = {}) {
    super(detail)
    this.name = 'MediaRejected'
    this.problem = problem
    this.statusCode = problem.status
    this.safeDetail = detail
    Object.assign(this, extra)
  }
}

/** Inspected from the bytes, never from what the client said (FR-052). */
export const ALLOWED_MIME = Object.freeze({
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
})

/**
 * SVG is refused outright, and not as an oversight.
 *
 * An SVG is a document, not a bitmap: it can carry `<script>`, external
 * references and event handlers. Storing one and serving it from the club's own
 * origin is a stored-XSS primitive against every logged-in member. Partner
 * logos that genuinely need vector fidelity are a deliberate, staff-only,
 * sanitised exception — specified when that need is real rather than pre-built
 * now, because a half-built sanitiser is worse than none.
 */
export const REFUSED_OUTRIGHT = Object.freeze({
  'image/svg+xml': 'SVG can carry script and is refused outright — it would be a stored-XSS primitive on this origin.',
  'text/html': 'HTML is not media.',
  'application/xml': 'XML is not media.',
})

const looksLikeSvg = (buffer) => {
  // `file-type` reads magic bytes and does not recognise SVG, which is text. A
  // sniff is therefore required, or the outright refusal above never fires.
  const head = buffer.subarray(0, 1024).toString('utf8').toLowerCase()
  return head.includes('<svg') || (head.includes('<?xml') && head.includes('svg'))
}

/**
 * Intrinsic dimensions read from the file header alone.
 *
 * Hand-parsed rather than handed to an image library, because the entire point
 * is to learn the declared size *without* letting a decoder allocate for it.
 *
 * @returns {{width: number, height: number}|null} null when unreadable, which
 *          the caller must treat as a refusal rather than as "unbounded".
 */
export function readDeclaredDimensions(buffer, mime) {
  try {
    if (mime === 'image/png') {
      // IHDR is fixed at offset 16 and is the first chunk by specification.
      if (buffer.length < 24) return null
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }

    if (mime === 'image/jpeg') {
      // Walk the segment markers to the first SOFn, which carries the size.
      let offset = 2
      while (offset + 9 < buffer.length) {
        if (buffer[offset] !== 0xff) return null
        const marker = buffer[offset + 1]
        const length = buffer.readUInt16BE(offset + 2)
        // SOF0..SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
        }
        offset += 2 + length
      }
      return null
    }

    if (mime === 'image/webp') {
      if (buffer.length < 30 || buffer.toString('ascii', 8, 12) !== 'WEBP') return null
      const format = buffer.toString('ascii', 12, 16)
      if (format === 'VP8X') {
        return {
          width: buffer.readUIntLE(24, 3) + 1,
          height: buffer.readUIntLE(27, 3) + 1,
        }
      }
      if (format === 'VP8 ') {
        return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
      }
      if (format === 'VP8L') {
        const bits = buffer.readUInt32LE(21)
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
      }
      return null
    }
  } catch {
    // A header that throws while being parsed is a header we do not trust.
    return null
  }
  // Video dimensions come from the probe, which runs as a bounded subprocess.
  return null
}

/**
 * Steps 1-4. Returns the facts the rest of the pipeline works from.
 *
 * @param buffer the upload, already capped at `maxBytes` during streaming
 * @returns {Promise<{kind: 'image'|'video', mime: string, bytes: number, declared: {width, height}|null}>}
 */
export async function validateUpload(buffer, { maxBytes, maxPixels, maxDimension = 20000 } = {}) {
  // ---- 1. byte cap -------------------------------------------------------
  // The stream enforces this as bytes arrive; re-checked here because this
  // function is also called directly by the video job, where nothing streamed.
  if (!buffer || buffer.length === 0) {
    throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'The upload is empty.')
  }
  if (buffer.length > maxBytes) {
    throw new MediaRejected(PROBLEMS.MEDIA_TOO_LARGE, `The upload exceeds the ${Math.floor(maxBytes / 1048576)} MB limit.`)
  }

  // ---- 2. magic bytes ----------------------------------------------------
  if (looksLikeSvg(buffer)) {
    throw new MediaRejected(PROBLEMS.UNSUPPORTED_MEDIA_TYPE, REFUSED_OUTRIGHT['image/svg+xml'])
  }

  const detected = await fileTypeFromBuffer(buffer)
  if (!detected) {
    throw new MediaRejected(PROBLEMS.UNSUPPORTED_MEDIA_TYPE, 'The file type could not be determined from its contents.')
  }

  // ---- 3. allowlist ------------------------------------------------------
  if (REFUSED_OUTRIGHT[detected.mime]) {
    throw new MediaRejected(PROBLEMS.UNSUPPORTED_MEDIA_TYPE, REFUSED_OUTRIGHT[detected.mime])
  }
  const kind = ALLOWED_MIME[detected.mime]
  if (!kind) {
    throw new MediaRejected(
      PROBLEMS.UNSUPPORTED_MEDIA_TYPE,
      `Files of type ${detected.mime} are not accepted.`,
    )
  }

  // ---- 4. declared dimensions, BEFORE decode -----------------------------
  let declared = null
  if (kind === 'image') {
    declared = readDeclaredDimensions(buffer, detected.mime)
    if (!declared || !declared.width || !declared.height) {
      // Unreadable is a refusal, not a pass. Treating it as "unknown, proceed"
      // would hand the decompression-bomb case straight to the decoder.
      throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'The image header could not be read.')
    }
    if (declared.width > maxDimension || declared.height > maxDimension) {
      throw new MediaRejected(
        PROBLEMS.MEDIA_DIMENSIONS_EXCEEDED,
        `The image declares ${declared.width}×${declared.height}, beyond the ${maxDimension} px limit on either side.`,
      )
    }
    if (declared.width * declared.height > maxPixels) {
      throw new MediaRejected(
        PROBLEMS.MEDIA_DIMENSIONS_EXCEEDED,
        `The image declares ${declared.width * declared.height} pixels, beyond the ${maxPixels} limit.`,
      )
    }
  }

  return { kind, mime: detected.mime, bytes: buffer.length, declared }
}

/**
 * Whether the client's claimed type agrees with the bytes.
 *
 * Not used to decide anything — the bytes already did that. It exists so the
 * disagreement can be logged, which is how a batch of mislabelled uploads from
 * one client gets noticed (SC-021).
 */
export function extensionAgrees(filename, mime) {
  const ext = String(filename ?? '').toLowerCase().split('.').pop()
  const expected = {
    'image/jpeg': ['jpg', 'jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/avif': ['avif'],
    'video/mp4': ['mp4', 'm4v'], 'video/webm': ['webm'], 'video/quicktime': ['mov', 'qt'],
  }[mime]
  return Boolean(expected?.includes(ext))
}
