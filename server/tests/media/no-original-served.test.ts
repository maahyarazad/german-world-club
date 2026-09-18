import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph } from '../helpers/media.ts'
import { hasDatabase } from '../helpers/db.ts'
import { VARIANTS } from '@gwc/contracts/media'

/**
 * SC-018, FR-060 — the original is a storage artefact, not a delivery path.
 *
 * Constitution Principle VI: nothing leaves the server in a shape or size the
 * server did not choose. The original is the one object in the system that was
 * chosen by whoever uploaded it, so it is precisely the thing that must never
 * be linked. A single `<img src>` pointing at a 2 MB original undoes the entire
 * pipeline on the page that matters most — and it is an easy line to write,
 * because the original is right there in the asset row.
 *
 * So this suite attacks it from both ends: no response may *reference* the
 * original's key, and no route may *serve* it even when asked directly.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('no response references the original (SC-018)', () => {
  let headers
  let asset
  let originalKey

  beforeAll(async () => { headers = (await uploader(app)).headers })

  beforeEach(async () => {
    await resetMedia(app.pg)
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })
    asset = response.json()
    const { rows } = await app.pg.query('SELECT storage_key FROM assets WHERE id = $1', [asset.id])
    originalKey = rows[0].storage_key
  })

  it('stores an original under a key that is nowhere in the upload response', () => {
    expect(originalKey).toContain('original')
    expect(JSON.stringify(asset)).not.toContain('original')
  })

  it('offers only declared variants, never the source', () => {
    for (const variant of asset.variants) {
      expect(VARIANTS).toContain(variant.variant)
      expect(variant.variant).not.toBe('original')
    }
  })

  it('keeps the original out of GET /media/:id as well', async () => {
    const response = await app.inject({ method: 'GET', url: `/media/${asset.id}`, headers })
    expect(response.statusCode).toBe(200)
    expect(response.body).not.toContain('original')
    expect(response.body).not.toContain(originalKey)
  })

  /**
   * The direct attempt. Knowing the checksum — which is public, it is in every
   * variant URL — must not be enough to reach the source bytes.
   */
  it('refuses to serve the original even when asked for by name', async () => {
    const checksum = asset.variants[0].url.split('/')[2]

    for (const attempt of [
      `/media/${checksum}/original.jpg`,
      `/media/${checksum}/original.webp`,
      `/media/${checksum}/source.jpg`,
    ]) {
      const response = await app.inject({ method: 'GET', url: attempt })
      expect(response.statusCode, attempt).toBe(404)
    }
  })

  it('does not expose the storage key through the delivery route either', async () => {
    const response = await app.inject({ method: 'GET', url: `/media/${originalKey}` })
    expect([404, 400]).toContain(response.statusCode)
  })
})

describe.skipIf(!hasDatabase)('no public page references an original (FR-060)', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('renders public surfaces without a single reference to a stored original', async () => {
    await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    for (const path of ['/', '/sitemap.xml', '/robots.txt']) {
      const response = await app.inject({ method: 'GET', url: path })
      expect(response.body, `${path} references an original`).not.toMatch(/\/original\./)
    }
  })

  /**
   * The counter-assertion. Without it this suite would pass against a server
   * that served no images at all, which is not the property being claimed.
   */
  it('DOES reference real variant URLs, so the check is not vacuous', async () => {
    const response = await upload(app, headers, {
      file: await photograph({ width: 2400, height: 1600 }), filename: 'p.jpg', alt: 'A photograph',
    })

    const urls = response.json().variants.map((v) => v.url)
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      expect(url).toMatch(/\/media\/[0-9a-f]{64}\/(thumb|small|medium|large)\.(webp|jpg|png)$/)
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
    }
  })
})
