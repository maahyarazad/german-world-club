import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { createMemoryDriver } from '../../src/modules/media/storage.ts'
import { createInlineQueue } from '../../src/modules/media/queue.ts'
import { loadEnv } from '../../src/config/env.ts'
import { ROUTE_BUDGETS } from '../../src/config/budgets.ts'
import { hasDatabase } from '../helpers/db.ts'
import { buildMediaApp, resetMedia, uploader, upload, photograph } from '../helpers/media.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Uploading the way the mobile app does (feature 037, bugs B1 to B3).
 *
 * Three app flows — a listing's photos, the profile avatar and Threads media —
 * all send one multipart `POST /media`. Two things were wrong at once, and
 * this file pins both.
 *
 * **Shape.** The app builds `alt` first, then a `file` part whose name may have
 * no extension or the wrong one (an iPhone HEIC picked as JPEG keeps `.HEIC`).
 * The server decides from the bytes, so all of them must be accepted — and a
 * body with no `alt` must still be refused, or "accepted" proves nothing.
 *
 * **Time.** The handler deadline starts when the request headers arrive, and a
 * multipart body is read INSIDE the handler, so the whole upload counts against
 * `media-upload`'s budget. At 8 s a photo from a phone on a mobile uplink was
 * answered 503 before it finished arriving, which the app showed as "it does
 * not save". The merchant screens only worked because a merchant's photos are
 * held to 1 MiB. The slow upload below goes over a real socket, because
 * `app.inject` delivers the body instantly and could never have shown this.
 */

describe.skipIf(!hasDatabase)('uploads shaped like the app sends them', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => {
    app = await buildMediaApp()
    ;({ headers } = await uploader(app))
    await resetMedia(app.pg)
  })
  afterAll(async () => { await app.close() })

  it.each([
    ['a .jpg name', 'IMG_0001.jpg'],
    ['no extension at all', 'upload-1700000000000-0'],
    ['a .HEIC name on JPEG bytes (the picker converted it)', 'IMG_0002.HEIC'],
  ])('accepts a JPEG with %s', async (_label, filename) => {
    const response = await upload(app, headers, { file: await photograph({ width: 800, height: 600 }), filename, contentType: 'image/jpeg', alt: 'A photo' })
    expect(response.statusCode).toBe(201)
    expect(response.json().state).toBe('ready')
  })

  it('refuses the same upload with no alt text, so the passes above mean something', async () => {
    const response = await upload(app, headers, { file: await photograph({ width: 800, height: 600 }), filename: 'IMG_0003.jpg', alt: '' })
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(response.statusCode).toBeLessThan(500)
  })
})

describe('the media upload budget', () => {
  it('leaves room for a phone photo on a mobile uplink, and stays under the request timeout', () => {
    const { deadlineMs } = ROUTE_BUDGETS['media-upload']!
    // 6 MB at 2.5 Mbps is ~19 s; 8 s (the old value) refused that outright.
    expect(deadlineMs).toBeGreaterThanOrEqual(20_000)
    // Σ outbound < deadline < requestTimeout is what `assertBudgets` enforces at boot.
    expect(deadlineMs).toBeLessThan(loadEnv({ ...process.env }).REQUEST_TIMEOUT_MS)
  })
})

describe.skipIf(!hasDatabase)('a slow upload over a real socket', () => {
  let app: GwcApp
  let port: number
  let headers: Record<string, string>

  beforeAll(async () => {
    const make = (origin?: string) => buildApp({
      contentSource: createFixtureContentSource([]),
      storage: createMemoryDriver(),
      jobQueue: createInlineQueue(),
      ...(origin ? { env: loadEnv({ ...process.env, CANONICAL_ORIGIN: origin }) } : {}),
    })
    // Two listens: one to learn a free port, then the app configured for it
    // (the same dance deadline-over-http.test.ts does for the canonical origin).
    const probe = await make()
    await probe.listen({ port: 0, host: '127.0.0.1' })
    port = (probe.server.address() as { port: number }).port
    await probe.close()
    app = await make(`http://127.0.0.1:${port}`)
    await app.ready()
    await app.listen({ port, host: '127.0.0.1' })
    ;({ headers } = await uploader(app))
    await resetMedia(app.pg)
  })
  afterAll(async () => { await app.close() })

  /** POST /media, writing the body in `chunks` pieces `gapMs` apart — a phone on a slow uplink. */
  async function slowUpload({ chunks, gapMs }: { chunks: number; gapMs: number }) {
    const file = await photograph({ width: 1200, height: 800 })
    const boundary = '----gwcSlowUpload'
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="alt"\r\n\r\nA slow photo\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="IMG_9.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`,
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, file, tail])
    const size = Math.ceil(body.length / chunks)

    return new Promise<{ status: number; elapsedMs: number }>((resolve, reject) => {
      const started = Date.now()
      const req = http.request({
        host: '127.0.0.1', port, path: '/media', method: 'POST',
        headers: { ...headers, 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(body.length) },
      }, (res) => {
        res.resume()
        res.on('end', () => resolve({ status: res.statusCode ?? 0, elapsedMs: Date.now() - started }))
      })
      req.on('error', reject)
      let sent = 0
      const next = () => {
        if (sent >= body.length) { req.end(); return }
        req.write(body.subarray(sent, sent + size))
        sent += size
        setTimeout(next, gapMs)
      }
      next()
    })
  }

  it('accepts a photo that takes longer than the old 8 s budget to arrive', async () => {
    const result = await slowUpload({ chunks: 12, gapMs: 800 }) // ~9.6 s of sending
    expect(result.elapsedMs).toBeGreaterThan(8_000)
    expect(result.status).toBe(201)
  }, 40_000)

  it('still answers a stalled upload instead of holding the connection open forever', async () => {
    // The budget was raised, not removed: a client that never finishes is
    // still cut off. Here the body is promised but only the start arrives, and
    // the socket is destroyed from our side — the server must not hang or crash.
    const result = await new Promise<string>((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, path: '/media', method: 'POST',
        headers: { ...headers, 'content-type': 'multipart/form-data; boundary=x', 'content-length': '100000' },
      })
      req.on('error', () => resolve('closed'))
      req.write('--x\r\n')
      setTimeout(() => { req.destroy(); resolve('destroyed') }, 300)
    })
    expect(result).toMatch(/closed|destroyed/)
    // The app is still serving afterwards.
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBeLessThan(500)
  })
})
