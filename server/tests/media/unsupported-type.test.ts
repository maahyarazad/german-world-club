import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ACCEPTED_MEDIA_TYPES, isAcceptedMediaType } from '@gwc/contracts/media'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildProblem } from '../../src/plugins/14-error-handler.ts'
import { ALLOWED_MIME } from '../../src/modules/media/validate.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildMediaApp, resetMedia, uploader, upload, photograph } from '../helpers/media.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * A photo the server cannot accept, and what it says about it (feature 037, bug B4).
 *
 * An iPhone saves HEIC. The server's image library reads a HEIC's header but
 * cannot decode its pixels (no HEVC decoder in the prebuilt libheif — checked
 * against a real HEIC, research R12), so it refuses the type by its bytes. That
 * refusal must stay a typed problem and must now say, as data, which type it
 * found and which it accepts, so the app can tell the person what to do without
 * parsing English prose.
 *
 * The fixture is a synthetic file header: `file-type` decides from the `ftyp`
 * box's brand, so eight bytes of structure are enough, and no one's photograph
 * (or Apple's wallpaper) needs to live in the repository.
 */

/** An ISO-BMFF `ftyp` box with the given major brand: what an iPhone photo starts with. */
function ftyp(brand: string) {
  const box = Buffer.alloc(32)
  box.writeUInt32BE(32, 0)
  box.write('ftyp', 4, 'ascii')
  box.write(brand, 8, 'ascii')
  box.write('mif1', 16, 'ascii')
  box.write(brand, 20, 'ascii')
  return box
}

describe('the shared list of accepted types', () => {
  it('is the one the server validates against, so the clients and the server cannot disagree', () => {
    expect(ALLOWED_MIME).toBe(ACCEPTED_MEDIA_TYPES)
  })

  it('accepts what members upload, and leaves HEIC and HEIF out', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'video/mp4', 'video/webm', 'video/quicktime']) {
      expect(isAcceptedMediaType(mime)).toBe(true)
    }
    for (const mime of ['image/heic', 'image/heif', 'image/tiff', 'image/gif', 'image/svg+xml', 'application/pdf', '', null, undefined]) {
      expect(isAcceptedMediaType(mime as string)).toBe(false)
    }
    // Case does not matter for a type a client reports.
    expect(isAcceptedMediaType('IMAGE/JPEG')).toBe(true)
  })
})

describe('problem extension members', () => {
  const request = { url: '/media?x=1', id: 'req-1' } as never

  it('are added to the body', () => {
    const body = buildProblem({ problem: PROBLEMS.UNSUPPORTED_MEDIA_TYPE, extensions: { detectedType: 'image/heic' } }, request)
    expect(body).toMatchObject({ type: PROBLEMS.UNSUPPORTED_MEDIA_TYPE.type, status: 400, detectedType: 'image/heic' })
  })

  it('can never replace a standard member', () => {
    const body = buildProblem(
      { problem: PROBLEMS.UNSUPPORTED_MEDIA_TYPE, extensions: { type: 'https://evil.example/', status: 200, requestId: 'forged', ok: true } },
      request,
    )
    expect(body.type).toBe(PROBLEMS.UNSUPPORTED_MEDIA_TYPE.type)
    expect(body.status).toBe(400)
    expect(body.requestId).toBe('req-1')
    // The counter-assertion: a non-standard key still gets through.
    expect(body).toHaveProperty('ok', true)
  })

  it('are absent when an error carries none, and nothing else is copied off the error', () => {
    const body = buildProblem({ problem: PROBLEMS.NOT_FOUND, secret: 'do not leak', stack: 'trace' }, request)
    expect(JSON.stringify(body)).not.toMatch(/do not leak|trace/)
  })
})

describe.skipIf(!hasDatabase)('POST /media with a file the server cannot accept', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await buildMediaApp()
    ;({ headers } = await uploader(app))
  })
  afterAll(async () => { await app.close() })

  const assetCount = async () => (await app.pg.query('SELECT count(*)::int AS n FROM assets')).rows[0].n as number

  it.each([
    ['heic', 'image/heic', 'IMG_0001.HEIC'],
    ['mif1', 'image/heif', 'IMG_0002.heif'],
  ])('answers an iPhone photo (%s brand) with 400 unsupported-media-type and says what it found', async (brand, detected, filename) => {
    await resetMedia(app.pg)
    const response = await upload(app, headers, { file: ftyp(brand), filename, contentType: detected, alt: 'An iPhone photo' })

    expect(response.statusCode).toBe(400)
    expect(response.headers['content-type']).toMatch(/application\/problem\+json/)
    const body = response.json()
    expect(body.type).toBe(PROBLEMS.UNSUPPORTED_MEDIA_TYPE.type)
    // Data a client can act on, not prose to parse.
    expect(body.detectedType).toBe(detected)
    expect(body.acceptedTypes).toEqual(Object.keys(ACCEPTED_MEDIA_TYPES))
    // Nothing was stored.
    expect(await assetCount()).toBe(0)
  })

  it('decides from the bytes, not the name: a HEIC called .jpg is still refused', async () => {
    await resetMedia(app.pg)
    const response = await upload(app, headers, { file: ftyp('heic'), filename: 'IMG_0003.jpg', contentType: 'image/jpeg', alt: 'Renamed' })
    expect(response.statusCode).toBe(400)
    expect(response.json().detectedType).toBe('image/heic')
  })

  it('gives detectedType null when the bytes match nothing', async () => {
    const response = await upload(app, headers, { file: Buffer.from('not a media file at all, just some text'), filename: 'x.jpg', alt: 'x' })
    expect(response.statusCode).toBe(400)
    expect(response.json().detectedType).toBeNull()
    expect(response.json().acceptedTypes.length).toBeGreaterThan(0)
  })

  it('still accepts a JPEG on the same route, so the refusals above mean something', async () => {
    await resetMedia(app.pg)
    const response = await upload(app, headers, { file: await photograph({ width: 800, height: 600 }), filename: 'IMG_0004.jpg', contentType: 'image/jpeg', alt: 'A photo' })
    expect(response.statusCode).toBe(201)
    expect(await assetCount()).toBe(1)
  })
})
