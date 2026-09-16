import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, uploader, resetMedia, upload, photograph } from '../helpers/media.js'
import { hasDatabase } from '../helpers/db.js'
import { createMember, bearerFor } from '../helpers/auth.js'

/**
 * media-pipeline.md §4.1 — identical bytes are stored once, and deleting one
 * reference must not break the other.
 *
 * Dedupe is a pleasant side effect of content-addressed storage, and it comes
 * with one sharp edge: once two records can point at the same bytes, a delete
 * that removes the bytes unconditionally silently breaks somebody else's page.
 * That failure is invisible at the moment it happens and surfaces later as a
 * missing logo on a paying partner's profile, so it is worth a suite of its
 * own.
 */
let app
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('two identical uploads store one copy', () => {
  let headers

  beforeAll(async () => { headers = (await uploader(app)).headers })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('returns the same asset and the same URLs for byte-identical uploads', async () => {
    const file = await photograph({ width: 800, height: 600 })

    const first = await upload(app, headers, { file, filename: 'a.jpg', alt: 'First upload' })
    const second = await upload(app, headers, { file, filename: 'b.jpg', alt: 'Second upload' })

    expect(first.statusCode).toBe(201)
    expect(second.statusCode).toBe(201)
    expect(second.json().id).toBe(first.json().id)
    expect(second.json().variants.map((v) => v.url)).toEqual(first.json().variants.map((v) => v.url))
  })

  it('records one asset row, not two', async () => {
    const file = await photograph({ width: 800, height: 600 })
    await upload(app, headers, { file, filename: 'a.jpg', alt: 'First' })
    await upload(app, headers, { file, filename: 'b.jpg', alt: 'Second' })

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n).toBe(1)
  })

  it('charges the quota once, not twice', async () => {
    const file = await photograph({ width: 800, height: 600 })
    await upload(app, headers, { file, filename: 'a.jpg', alt: 'First' })
    const { rows: after1 } = await app.pg.query(
      `SELECT used FROM counters WHERE scope = 'media.stored_bytes'`,
    )

    await upload(app, headers, { file, filename: 'b.jpg', alt: 'Second' })
    const { rows: after2 } = await app.pg.query(
      `SELECT used FROM counters WHERE scope = 'media.stored_bytes'`,
    )

    expect(Number(after2[0].used)).toBe(Number(after1[0].used))
  })

  it('still stores two copies for two DIFFERENT images', async () => {
    await upload(app, headers, { file: await photograph({ width: 800, height: 600 }), filename: 'a.jpg', alt: 'A' })
    await upload(app, headers, { file: await photograph({ width: 640, height: 480 }), filename: 'b.jpg', alt: 'B' })

    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets')
    expect(rows[0].n).toBe(2)
  })
})

describe.skipIf(!hasDatabase)('deleting one reference leaves the other intact', () => {
  let ownerHeaders
  let otherHeaders

  beforeAll(async () => {
    ownerHeaders = (await uploader(app)).headers
    const other = await createMember(app.pg)
    otherHeaders = await bearerFor(app, { accountId: other.id, accountKind: 'member' })
  })
  beforeEach(async () => { await resetMedia(app.pg) })

  it('removes the bytes when nothing else points at them', async () => {
    const response = await upload(app, ownerHeaders, {
      file: await photograph({ width: 800, height: 600 }), filename: 'a.jpg', alt: 'Only copy',
    })
    const asset = response.json()

    const deleted = await app.inject({ method: 'DELETE', url: `/media/${asset.id}`, headers: ownerHeaders })
    expect(deleted.statusCode).toBe(200)
    expect(deleted.json().bytesRemoved).toBe(true)

    const fetched = await app.inject({ method: 'GET', url: asset.variants[0].url })
    expect(fetched.statusCode).toBe(404)
  })

  it('releases the quota on delete', async () => {
    const response = await upload(app, ownerHeaders, {
      file: await photograph({ width: 800, height: 600 }), filename: 'a.jpg', alt: 'Only copy',
    })
    await app.inject({ method: 'DELETE', url: `/media/${response.json().id}`, headers: ownerHeaders })

    const { rows } = await app.pg.query(`SELECT used FROM counters WHERE scope = 'media.stored_bytes'`)
    expect(Number(rows[0]?.used ?? 0)).toBe(0)
  })

  it('refuses a delete from somebody who does not own the asset', async () => {
    const response = await upload(app, ownerHeaders, {
      file: await photograph({ width: 800, height: 600 }), filename: 'a.jpg', alt: 'Mine',
    })

    const attempt = await app.inject({
      method: 'DELETE', url: `/media/${response.json().id}`, headers: otherHeaders,
    })
    expect(attempt.statusCode).toBe(403)

    const stillThere = await app.inject({ method: 'GET', url: response.json().variants[0].url })
    expect(stillThere.statusCode).toBe(200)
  })

  it('answers 404 for an asset that does not exist', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/media/00000000-0000-0000-0000-000000000000',
      headers: ownerHeaders,
    })
    expect(response.statusCode).toBe(404)
  })

  it('is idempotent enough not to break on a second delete', async () => {
    const response = await upload(app, ownerHeaders, {
      file: await photograph({ width: 800, height: 600 }), filename: 'a.jpg', alt: 'Mine',
    })
    const id = response.json().id

    expect((await app.inject({ method: 'DELETE', url: `/media/${id}`, headers: ownerHeaders })).statusCode).toBe(200)
    // The row is gone, so the second attempt is a 404 rather than a 500 — the
    // client learns the asset is not there, which is what it wanted.
    expect((await app.inject({ method: 'DELETE', url: `/media/${id}`, headers: ownerHeaders })).statusCode).toBe(404)
  })
})
