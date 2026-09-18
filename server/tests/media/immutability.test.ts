import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { checksumOf, keyFor, hexOf } from '../../src/modules/media/storage.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-062 — a variant URL is byte-identical across fetches, and says so.
 *
 * `immutable` is a promise a server usually cannot keep: it tells every cache
 * between here and the reader that the response will never change, and a cache
 * that believes it will not revalidate for a year. Getting that wrong is close
 * to unrecoverable, because there is no way to reach back into the caches.
 *
 * It is safe here for one structural reason: the path is content-addressed.
 * Different bytes produce a different SHA-256, so a given URL's content cannot
 * change — a new version is simply a different URL. The immutability is a fact
 * about the addressing scheme rather than a promise about future behaviour,
 * which is what these tests assert.
 */
let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe('the addressing scheme is what makes immutability safe', () => {
  it('gives different bytes a different key', () => {
    const a = checksumOf(Buffer.from('the original bytes'))
    const b = checksumOf(Buffer.from('the original bytes, edited'))
    expect(keyFor(a, { variant: 'medium', format: 'webp' }))
      .not.toBe(keyFor(b, { variant: 'medium', format: 'webp' }))
  })

  it('gives identical bytes the same key, every time', () => {
    const once = checksumOf(Buffer.from('identical'))
    const twice = checksumOf(Buffer.from('identical'))
    expect(hexOf(once)).toBe(hexOf(twice))
  })

  it('separates variants and formats within one checksum', () => {
    const checksum = checksumOf(Buffer.from('one image'))
    const keys = [
      keyFor(checksum, { variant: 'thumb', format: 'webp' }),
      keyFor(checksum, { variant: 'thumb', format: 'jpeg' }),
      keyFor(checksum, { variant: 'large', format: 'webp' }),
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe.skipIf(!hasDatabase)('as served (FR-062)', () => {
  let headers: Record<string, string>
  let variants: Record<string, unknown>

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => {
    await resetMedia(app.pg)
    const response = await upload(app, headers, {
      file: await photograph({ width: 1200, height: 800 }), filename: 'p.jpg', alt: 'A photograph',
    })
    variants = response.json().variants
  })

  it('returns byte-identical content across repeated fetches', async () => {
    const target = variants.find((v) => v.variant === 'medium' && v.format === 'webp')

    const first = await app.inject({ method: 'GET', url: target.url })
    const second = await app.inject({ method: 'GET', url: target.url })
    const third = await app.inject({ method: 'GET', url: target.url })

    expect(first.statusCode).toBe(200)
    expect(Buffer.compare(first.rawPayload, second.rawPayload)).toBe(0)
    expect(Buffer.compare(second.rawPayload, third.rawPayload)).toBe(0)
  })

  it('carries `immutable` and a one-year max-age', async () => {
    for (const variant of variants) {
      const response = await app.inject({ method: 'GET', url: variant.url })
      expect(response.headers['cache-control'], variant.url).toBe('public, max-age=31536000, immutable')
    }
  })

  /**
   * `nosniff` with an explicit Content-Type is what stops a polyglot file —
   * valid as both an image and something executable — being re-interpreted by a
   * browser as the latter, on the club's own origin, where it would inherit
   * every member's session.
   */
  it('carries X-Content-Type-Options: nosniff with an explicit type', async () => {
    for (const variant of variants) {
      const response = await app.inject({ method: 'GET', url: variant.url })
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['content-type']).toBeTruthy()
      expect(response.headers['content-type']).not.toMatch(/octet-stream/)
    }
  })

  it('is delivered inline rather than as a download', async () => {
    const target = variants[0]
    const response = await app.inject({ method: 'GET', url: target.url })
    expect(response.headers['content-disposition']).toMatch(/^inline;/)
  })

  it('has the checksum in the URL, so a changed image is a changed URL', async () => {
    const { rows } = await app.pg.query('SELECT encode(checksum, \'hex\') AS hex FROM assets LIMIT 1')
    for (const variant of variants) {
      expect(variant.url).toContain(rows[0].hex)
    }
  })

  it('answers 404 for a checksum that addresses nothing, rather than a cached error', async () => {
    const response = await app.inject({ method: 'GET', url: `/media/${'a'.repeat(64)}/medium.webp` })
    expect(response.statusCode).toBe(404)
    expect(response.headers['cache-control'] ?? '').not.toMatch(/immutable/)
  })
})
