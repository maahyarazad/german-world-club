import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import sharp from 'sharp'
import { buildMediaApp, uploader, resetMedia, upload, photographWithGps } from '../helpers/media.js'
import { hasDatabase } from '../helpers/db.js'
import { stripMetadata, hasLocationMetadata } from '../../src/media/strip-metadata.js'

/**
 * SC-020, FR-054 — no location metadata survives ingest.
 *
 * A photograph taken on a phone carries EXIF, and EXIF routinely carries GPS
 * coordinates. A member posting a picture from their living room would
 * otherwise publish their home address to anyone who downloads it. Nobody
 * involved expects that, which is precisely why it cannot be left to members
 * being careful — it has to be a property of the pipeline.
 *
 * The requirement covers the stored **original** as well as every derivative.
 * The original is not served today (FR-060), but "not currently routed" is a
 * property of this month's routes, not of the bytes on disk.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe('the fixture really carries what we claim (FR-054)', () => {
  it('has GPS metadata before stripping — otherwise this suite proves nothing', async () => {
    const withGps = await photographWithGps()
    expect(await hasLocationMetadata(withGps)).toBe(true)

    const meta = await sharp(withGps).metadata()
    expect(meta.exif, 'an EXIF block must be present to begin with').toBeTruthy()
  })
})

describe('stripping removes it (SC-020)', () => {
  it('leaves no EXIF behind', async () => {
    const stripped = await stripMetadata(await photographWithGps(), { limitInputPixels: 50_000_000 })
    expect(await hasLocationMetadata(stripped.buffer)).toBe(false)

    const meta = await sharp(stripped.buffer).metadata()
    expect(meta.exif).toBeFalsy()
    expect(meta.xmp).toBeFalsy()
  })

  it('keeps the picture itself intact', async () => {
    const source = await photographWithGps()
    const before = await sharp(source).metadata()
    const stripped = await stripMetadata(source, { limitInputPixels: 50_000_000 })

    expect(stripped.width).toBe(before.width)
    expect(stripped.height).toBe(before.height)
  })

  /**
   * Orientation is the one tag that must be *applied* rather than simply
   * dropped. Discarding it without rotating the pixels turns every portrait
   * photograph from a phone on its side — a regression that looks like a
   * rendering bug and is actually a metadata bug.
   */
  it('bakes EXIF orientation into the pixels rather than discarding it', async () => {
    const rotated = await sharp({
      create: { width: 200, height: 100, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 }) // 90° clockwise
      .toBuffer()

    const stripped = await stripMetadata(rotated, { limitInputPixels: 50_000_000 })
    const meta = await sharp(stripped.buffer).metadata()

    // The orientation tag is gone…
    expect(meta.orientation).toBeUndefined()
    // …because the rotation it described has been applied: 200×100 became
    // 100×200.
    expect({ width: stripped.width, height: stripped.height }).toEqual({ width: 100, height: 200 })
  })
})

describe.skipIf(!hasDatabase)('nothing stored or delivered carries location (SC-020)', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('strips the ORIGINAL, not only the derivatives', async () => {
    const response = await upload(app, headers, {
      file: await photographWithGps(), filename: 'holiday.jpg', contentType: 'image/jpeg', alt: 'A holiday',
    })
    expect(response.statusCode).toBe(201)

    const { rows } = await app.pg.query('SELECT storage_key FROM assets LIMIT 1')
    const original = await app.mediaStorage.get(rows[0].storage_key)

    expect(await hasLocationMetadata(original)).toBe(false)
  })

  it('strips every derivative', async () => {
    const response = await upload(app, headers, {
      file: await photographWithGps(), filename: 'holiday.jpg', contentType: 'image/jpeg', alt: 'A holiday',
    })

    const variants = response.json().variants
    expect(variants.length).toBeGreaterThan(0)

    for (const variant of variants) {
      const fetched = await app.inject({ method: 'GET', url: variant.url })
      expect(fetched.statusCode).toBe(200)
      expect(
        await hasLocationMetadata(fetched.rawPayload),
        `${variant.variant}.${variant.format} still carries metadata`,
      ).toBe(false)
    }
  })

  /**
   * The direct assertion, in case a future encoder keeps a metadata block this
   * suite's helper does not recognise: the coordinate bytes themselves must not
   * appear anywhere in anything stored.
   */
  it('leaves no GPS byte sequence anywhere in the stored objects', async () => {
    await upload(app, headers, {
      file: await photographWithGps(), filename: 'holiday.jpg', contentType: 'image/jpeg', alt: 'A holiday',
    })

    for (const [key, body] of app.mediaStorage.objects) {
      expect(body.includes(Buffer.from('Exif')), `${key} contains an EXIF marker`).toBe(false)
      expect(body.includes(Buffer.from('GPS')), `${key} contains a GPS marker`).toBe(false)
    }
  })
})
