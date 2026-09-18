import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph, opaquePng, svgWithScript } from '../helpers/media.js'
import { hasDatabase } from '../helpers/db.js'
import { validateUpload, extensionAgrees, MediaRejected, ALLOWED_MIME } from '../../src/modules/media/validate.js'

/**
 * SC-021, FR-052 — the type comes from the bytes, never from the name.
 *
 * A filename and a `Content-Type` header are both supplied by whoever is
 * uploading, which makes them claims rather than facts. Trusting either is the
 * standard route to storing a file the server believes is a PNG and a browser
 * treats as something else entirely.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const LIMITS = { maxBytes: 26_214_400, maxPixels: 50_000_000 }

describe('the type is read from the content (FR-052)', () => {
  it('types a JPEG as a JPEG however it is named', async () => {
    const jpeg = await photograph({ width: 400, height: 300 })
    const result = await validateUpload(jpeg, LIMITS)
    expect(result.mime).toBe('image/jpeg')
    expect(result.kind).toBe('image')
  })

  it('types a PNG as a PNG however it is named', async () => {
    const png = await opaquePng({ width: 200, height: 100 })
    expect((await validateUpload(png, LIMITS)).mime).toBe('image/png')
  })

  it('reports a .png-named JPEG as a disagreement, having already typed it correctly', async () => {
    const jpeg = await photograph({ width: 400, height: 300 })
    const result = await validateUpload(jpeg, LIMITS)

    expect(result.mime).toBe('image/jpeg')
    // The name is wrong and the bytes are right — which is the whole point.
    expect(extensionAgrees('holiday.png', result.mime)).toBe(false)
    expect(extensionAgrees('holiday.jpg', result.mime)).toBe(true)
  })

  it('refuses a file whose contents are not media at all, whatever it is called', async () => {
    const notMedia = Buffer.from('#!/bin/sh\nrm -rf /\n', 'utf8')
    await expect(validateUpload(notMedia, LIMITS)).rejects.toThrow(MediaRejected)
  })

  it('refuses an empty upload', async () => {
    await expect(validateUpload(Buffer.alloc(0), LIMITS)).rejects.toThrow(/empty/i)
  })

  it('accepts exactly the documented allowlist and nothing else', () => {
    expect(Object.keys(ALLOWED_MIME).sort()).toEqual([
      'image/avif', 'image/jpeg', 'image/png', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm',
    ])
  })
})

describe('SVG is refused outright', () => {
  it('refuses an SVG carrying script', async () => {
    await expect(validateUpload(svgWithScript, LIMITS)).rejects.toThrow(/SVG/)
  })

  it('refuses a plain SVG too — the refusal is about the format, not the payload', async () => {
    const plain = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', 'utf8')
    await expect(validateUpload(plain, LIMITS)).rejects.toThrow(/SVG/)
  })

  it('refuses one declaring an XML prolog first, which file-type does not recognise', async () => {
    const prologued = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>',
      'utf8',
    )
    await expect(validateUpload(prologued, LIMITS)).rejects.toThrow(/SVG|not accepted|could not be determined/)
  })
})

describe.skipIf(!hasDatabase)('through the real endpoint (SC-021)', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('accepts a correctly-named image', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 800, height: 600 }),
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
      alt: 'A club event',
    })
    expect(response.statusCode).toBe(201)
    expect(response.json().mime).toBe('image/jpeg')
  })

  /**
   * The headline case. The extension and the declared Content-Type both say
   * PNG; the bytes say JPEG. The server stores it as a JPEG and says so.
   */
  it('stores a .png-named JPEG as image/jpeg, ignoring both the name and the header', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 800, height: 600 }),
      filename: 'definitely-a.png',
      contentType: 'image/png',
      alt: 'Mislabelled on purpose',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().mime).toBe('image/jpeg')
  })

  it('refuses an executable renamed to .jpg', async () => {
    const response = await upload(app, headers, {
      file: Buffer.from('MZ\x90\x00\x03\x00\x00\x00PE\x00\x00 not an image at all', 'binary'),
      filename: 'innocent.jpg',
      contentType: 'image/jpeg',
      alt: 'Should never be stored',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().type).toMatch(/unsupported-media-type|validation-failed/)

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n, 'nothing may be recorded for a refused upload').toBe(0)
  })

  it('refuses an SVG through the endpoint, naming the reason', async () => {
    const response = await upload(app, headers, {
      file: svgWithScript, filename: 'logo.svg', contentType: 'image/svg+xml', alt: 'Partner logo',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().detail).toMatch(/SVG/)
  })

  it('requires alt text, because §10.1 galleries need it', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 400, height: 300 }), filename: 'x.jpg', alt: '',
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().detail).toMatch(/alt/i)
  })
})
