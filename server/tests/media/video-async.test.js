import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, shortVideo, hasFfmpeg } from '../helpers/media.js'
import { hasDatabase } from '../helpers/db.js'
import { processVideoJob } from '../../src/media/worker.js'
import { probeVideo } from '../../src/media/derive-video.js'

/**
 * FR-058, FR-059 — video is asynchronous, and never gets stuck.
 *
 * A WebM transcode takes minutes and is CPU-bound. It fits no request budget in
 * resilience.md §1, so the upload answers `202 processing` and the work happens
 * on a queue. That trade only holds if two things are true, and this file
 * asserts both:
 *
 *  1. **Dimensions are known immediately** (FR-055). §10.9's layout-shift
 *     requirement needs width and height at first render, and a client cannot
 *     wait for a transcode to reserve the box. So the probe is synchronous even
 *     though the derivation is not.
 *  2. **`processing` is never terminal.** The asset reaches `ready`, or it
 *     reaches `failed` *with a reason*. A row stuck in `processing` is worse
 *     than either: the client polls forever, no page can render it, and nothing
 *     says why.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

const RUNNABLE = hasDatabase && hasFfmpeg

describe.skipIf(!RUNNABLE)('upload answers 202 with dimensions already known', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('returns 202 `processing` rather than holding the request open', async () => {
    const response = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A club event clip',
    })

    expect(response.statusCode).toBe(202)
    const body = response.json()
    expect(body.state).toBe('processing')
    expect(body.kind).toBe('video')
  })

  it('records intrinsic dimensions before the request completes (FR-055)', async () => {
    const response = await upload(app, headers, {
      file: await shortVideo({ width: 320, height: 240 }), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })

    const body = response.json()
    expect(body.width).toBe(320)
    expect(body.height).toBe(240)
    // Duration too, which is what lets a player reserve its scrubber.
    expect(body.durationMs).toBeGreaterThan(0)
  })

  it('carries no derivatives yet — that is what `processing` means', async () => {
    const response = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    expect(response.json().variants).toEqual([])
  })

  it('is pollable through GET /media/:id', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })

    const polled = await app.inject({ method: 'GET', url: `/media/${created.json().id}`, headers })
    expect(polled.statusCode).toBe(200)
    expect(polled.json().state).toBe('processing')
    // The field a client needs to tell "still working" from "gave up".
    expect(polled.json().failureReason).toBeNull()
  })
})

describe.skipIf(!RUNNABLE)('the job produces derivatives and a poster (FR-058)', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('reaches `ready` with a WebM and a WebP poster', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    const id = created.json().id

    // Driven directly rather than through the queue: this asserts what the job
    // does, and waiting on a scheduler would make it a test of the scheduler.
    const outcome = await processVideoJob(app, { assetId: id })
    expect(outcome.outcome).toBe('ready')

    const polled = await app.inject({ method: 'GET', url: `/media/${id}`, headers })
    const body = polled.json()

    expect(body.state).toBe('ready')
    expect(body.failureReason).toBeNull()

    const byVariant = Object.fromEntries(body.variants.map((v) => [v.variant, v]))
    expect(byVariant.video?.format).toBe('webm')
    expect(byVariant.poster?.format).toBe('webp')
  })

  it('records real dimensions and byte counts for both', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    await processVideoJob(app, { assetId: created.json().id })

    const polled = await app.inject({ method: 'GET', url: `/media/${created.json().id}`, headers })
    for (const variant of polled.json().variants) {
      expect(variant.width, variant.variant).toBeGreaterThan(0)
      expect(variant.height).toBeGreaterThan(0)
      expect(variant.bytes).toBeGreaterThan(0)
    }
  })

  it('serves both derivatives at their content-addressed URLs', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    await processVideoJob(app, { assetId: created.json().id })

    const polled = await app.inject({ method: 'GET', url: `/media/${created.json().id}`, headers })
    for (const variant of polled.json().variants) {
      const fetched = await app.inject({ method: 'GET', url: variant.url })
      expect(fetched.statusCode, variant.url).toBe(200)
      expect(fetched.rawPayload.length).toBe(variant.bytes)
    }
  })

  it('never upscales the video either', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo({ width: 320, height: 240 }), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    await processVideoJob(app, { assetId: created.json().id })

    const polled = await app.inject({ method: 'GET', url: `/media/${created.json().id}`, headers })
    const video = polled.json().variants.find((v) => v.variant === 'video')
    expect(video.width).toBeLessThanOrEqual(320)
  })

  it('does not redo the work when a retry lands on an already-ready asset', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    await processVideoJob(app, { assetId: created.json().id })

    const repeat = await processVideoJob(app, { assetId: created.json().id })
    expect(repeat.outcome).toBe('already-ready')
  })
})

describe.skipIf(!RUNNABLE)('a failure is recorded, never left hanging (FR-059)', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  /**
   * The assertion this whole file is built around. The transcode is made to
   * fail by corrupting the stored original after the asset row exists — which
   * is a real failure mode (truncated upload, storage corruption), not only a
   * contrived one.
   */
  it('moves a broken asset to `failed` WITH a reason, not stuck in `processing`', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    const id = created.json().id

    const { rows } = await app.pg.query('SELECT storage_key FROM assets WHERE id = $1', [id])
    await app.mediaStorage.put(rows[0].storage_key, Buffer.from('not a video at all'))

    const outcome = await processVideoJob(app, { assetId: id })
    expect(outcome.outcome).toBe('failed')

    const polled = await app.inject({ method: 'GET', url: `/media/${id}`, headers })
    const body = polled.json()

    expect(body.state).toBe('failed')
    expect(body.state, 'a stuck `processing` row is the defect FR-059 names').not.toBe('processing')
    expect(body.failureReason).toBeTruthy()
  })

  it('records no derivatives for a failed asset', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })
    const { rows } = await app.pg.query('SELECT storage_key FROM assets WHERE id = $1', [created.json().id])
    await app.mediaStorage.put(rows[0].storage_key, Buffer.from('not a video at all'))

    await processVideoJob(app, { assetId: created.json().id })

    const polled = await app.inject({ method: 'GET', url: `/media/${created.json().id}`, headers })
    expect(polled.json().variants).toEqual([])
  })

  /**
   * The database enforces the same rule independently, so a future code path
   * that forgets to write a reason cannot produce the row either.
   */
  it('is refused by the database if a reason is ever omitted', async () => {
    const created = await upload(app, headers, {
      file: await shortVideo(), filename: 'clip.mp4', contentType: 'video/mp4', alt: 'A clip',
    })

    await expect(
      app.pg.query(`UPDATE assets SET state = 'failed' WHERE id = $1`, [created.json().id]),
    ).rejects.toThrow(/assets_failure_reason_matches_state/)
  })

  it('tolerates a job for an asset that has since been deleted', async () => {
    const outcome = await processVideoJob(app, { assetId: '00000000-0000-0000-0000-000000000000' })
    expect(outcome.outcome).toBe('gone')
  })
})

describe.skipIf(!hasFfmpeg)('probing is bounded, because a header read is not a transcode', () => {
  it('reads dimensions and duration from a real file', async () => {
    const probed = await probeVideo(await shortVideo({ width: 320, height: 240, seconds: 2 }))
    expect(probed.width).toBe(320)
    expect(probed.height).toBe(240)
    expect(probed.durationMs).toBeGreaterThan(1000)
  })

  it('returns nulls rather than throwing on something that is not a video', async () => {
    const probed = await probeVideo(Buffer.from('definitely not a video'))
    expect(probed.width).toBeNull()
    expect(probed.height).toBeNull()
  })
})
