import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, pixelBomb } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { validateUpload, readDeclaredDimensions } from '../../src/modules/media/validate.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-053 — the decompression bomb, refused **before** decode.
 *
 * A 91-byte PNG can declare 100,000 × 100,000 pixels. Decoded, that is ten
 * billion pixels — tens of gigabytes of allocation from a file that fits in a
 * tweet. There is no amount of memory that makes this safe to attempt, so the
 * check cannot be "decode it and see"; the declared size has to be read from
 * the header and refused on its own.
 *
 * "Before decode" is the assertion that matters and the one that is easy to
 * write vacuously. A test that only checks the status code would pass just as
 * well against a server that decoded the file, ran out of memory, and returned
 * 400 on the way down — right up until the day it takes the process with it. So
 * these assert the refusal comes from the header parser, and that the whole
 * thing is cheap.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const LIMITS = { maxBytes: 26_214_400, maxPixels: 50_000_000 }

describe('the header is read without decoding (FR-053)', () => {
  it('reads the declared size out of a tiny file', async () => {
    const bomb = await pixelBomb()
    expect(bomb.length).toBeLessThan(1024)
    expect(readDeclaredDimensions(bomb, 'image/png')).toEqual({ width: 100_000, height: 100_000 })
  })

  it('refuses it for the size it DECLARES, not for anything it contains', async () => {
    const bomb = await pixelBomb()
    await expect(validateUpload(bomb, LIMITS)).rejects.toThrow(/100000×100000|dimensions/)
  })

  /**
   * The cost assertion. Refusing from the header is microseconds; decoding
   * ten billion pixels is not survivable. A generous ceiling still separates
   * the two by orders of magnitude, so this stays meaningful without being
   * flaky on a loaded CI box.
   */
  it('refuses cheaply — the work is a header read, not an allocation', async () => {
    const bomb = await pixelBomb()
    const before = process.memoryUsage().heapUsed
    const started = process.hrtime.bigint()

    await expect(validateUpload(bomb, LIMITS)).rejects.toThrow()

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    const grewMb = (process.memoryUsage().heapUsed - before) / 1048576

    expect(elapsedMs, 'a header read should be immediate').toBeLessThan(250)
    expect(grewMb, 'nothing should have been allocated for the declared size').toBeLessThan(64)
  })

  it('refuses a bomb that is wide rather than square', async () => {
    // Asserted on the problem type rather than the prose: a 60,000 × 4 image
    // trips the per-side bound, not the pixel-count one, and both must answer
    // with the same refusal.
    await expect(validateUpload(await pixelBomb({ declaredWidth: 60_000, declaredHeight: 4 }), LIMITS))
      .rejects.toMatchObject({ problem: { type: expect.stringContaining('media-dimensions-exceeded') } })
  })

  /**
   * Both bounds exist and catch different shapes. A 19,000 × 19,000 image is
   * under the per-side limit and still 361 million pixels, which is why the
   * pixel-count bound is not redundant.
   */
  it('refuses on total pixel count even when each side is within bounds', async () => {
    const wide = await pixelBomb({ declaredWidth: 19_000, declaredHeight: 19_000 })
    await expect(validateUpload(wide, LIMITS)).rejects.toThrow(/pixels/)
  })

  it('accepts a large-but-reasonable image, so the bound is not simply "refuse everything"', async () => {
    const fine = await pixelBomb({ declaredWidth: 4000, declaredHeight: 3000 })
    const result = await validateUpload(fine, LIMITS)
    expect(result.declared).toEqual({ width: 4000, height: 3000 })
  })

  /**
   * An unreadable header is a refusal, not a pass. Treating "I could not tell"
   * as "unbounded, proceed" would hand the bomb case straight to the decoder,
   * which is the failure this whole file exists to prevent.
   */
  it('refuses an image whose header cannot be read at all', async () => {
    const truncated = (await pixelBomb()).subarray(0, 12)
    await expect(validateUpload(truncated, LIMITS)).rejects.toThrow()
  })
})

describe.skipIf(!hasDatabase)('through the real endpoint', () => {
  let headers: Record<string, string>

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('answers 400 media-dimensions-exceeded and stores nothing', async () => {
    const response = await upload(app, headers, {
      file: await pixelBomb(), filename: 'bomb.png', contentType: 'image/png', alt: 'A bomb',
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().type).toMatch(/media-dimensions-exceeded/)

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n).toBe(0)
  })

  it('leaves no stored object behind either', async () => {
    await upload(app, headers, {
      file: await pixelBomb(), filename: 'bomb.png', contentType: 'image/png', alt: 'A bomb',
    })
    expect(app.mediaStorage.objects.size).toBe(0)
  })
})
