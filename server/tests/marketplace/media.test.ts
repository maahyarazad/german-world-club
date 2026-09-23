import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildMediaApp, resetMedia, upload, photograph, shortVideo, hasVideoPipeline } from '../helpers/media.ts'
import { resetAuthTables } from '../helpers/auth.ts'
import { processVideoJob } from '../../src/modules/media/worker.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Listing media (US2, FR-013, FR-014, FR-039, FR-040, SC-017).
 *
 * §7 says a listing carries **one photo, several photos, or one video**, so all
 * three shapes are exercised rather than the easy one. The pipeline underneath
 * is `modules/media` unchanged — these suites assert the *linking*: order,
 * ownership, what the index renders for a video, and what deleting a link does
 * to bytes another listing may share.
 */

let app: GwcApp
beforeAll(async () => { app = await buildMediaApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('media on a listing', () => {
  let owner: Awaited<ReturnType<typeof poster>>
  let listingId: string

  beforeEach(async () => {
    // Marketplace first: its link rows reference assets ON DELETE RESTRICT, so
    // clearing assets while a link survives is the one order that cannot work.
    await resetMarketplace(app.pg)
    await resetMedia(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    listingId = await seedListing(app.pg, { ownerId: owner.id })
  })

  const uploadPhoto = async (alt = 'A listing photo', size = { width: 900, height: 600 }) => {
    const response = await upload(app, owner.headers, {
      file: await photograph(size), filename: 'p.jpg', alt,
    })
    expect(response.statusCode).toBe(201)
    return response.json()
  }

  const attach = (assetId: string, listing = listingId, headers = owner.headers) =>
    app.inject({
      method: 'POST',
      url: `/marketplace/listings/${listing}/media`,
      headers,
      payload: { assetId },
    })

  const fetchListing = () =>
    app.inject({ method: 'GET', url: `/marketplace/listings/${listingId}`, headers: owner.headers })

  // ---- The three shapes §7 names -----------------------------------------

  it('carries one photo', async () => {
    const asset = await uploadPhoto()
    const linked = await attach(asset.id)

    expect(linked.statusCode).toBe(201)
    expect(linked.json().position).toBe(0)

    const media = fetchListing().then((r) => r.json().media)
    expect((await media)).toHaveLength(1)
    expect((await media)[0].kind).toBe('image')
    expect((await media)[0].variants.length).toBeGreaterThan(0)
    // A photo has no poster frame; only a video does (FR-040).
    expect((await media)[0].posterUrl).toBeNull()
  })

  it('carries several photos, in the order they were attached', async () => {
    // Different sizes so the three uploads are genuinely three assets:
    // identical bytes would dedupe to one, and the ordering assertion would be
    // asserting nothing.
    const first = await uploadPhoto('First', { width: 900, height: 600 })
    const second = await uploadPhoto('Second', { width: 800, height: 600 })
    const third = await uploadPhoto('Third', { width: 700, height: 600 })

    for (const asset of [first, second, third]) {
      expect((await attach(asset.id)).statusCode).toBe(201)
    }

    const media = (await fetchListing()).json().media
    expect(media.map((m: { position: number }) => m.position)).toEqual([0, 1, 2])
    expect(media.map((m: { alt: string }) => m.alt)).toEqual(['First', 'Second', 'Third'])
  })

  it.skipIf(!hasVideoPipeline)('carries one video, and the index renders its poster', async () => {
    const response = await upload(app, owner.headers, {
      file: await shortVideo({ seconds: 1 }), filename: 'clip.mp4',
      contentType: 'video/mp4', alt: 'A short clip',
    })
    // A video upload answers 202: the transcode fits no request budget, so it
    // happens out of band (FR-058).
    expect(response.statusCode).toBe(202)
    const assetId = response.json().id

    // Attaching a still-processing asset is refused, on purpose — the index
    // would otherwise render a listing whose derivatives do not exist yet.
    // A retry, not a refusal, which is why it is a 400 and not a 404.
    expect((await attach(assetId)).statusCode).toBe(400)

    // Driven directly rather than through the queue: waiting on a scheduler
    // would make this a test of the scheduler (the video-async suite's
    // precedent).
    expect((await processVideoJob(app, { assetId })).outcome).toBe('ready')
    expect((await attach(assetId)).statusCode).toBe(201)

    const item = (await fetchListing()).json().media[0]
    expect(item.kind).toBe('video')
    // The point of FR-040: a browse page paints a still, so it neither
    // autoplays nor waits on a transcode.
    expect(item.posterUrl).toBeTruthy()
    // And the poster is kept OUT of `variants`, so a client building a
    // `<source>` list cannot pick it up as a playable rendition by accident.
    expect(item.variants.map((v: { variant: string }) => v.variant)).not.toContain('poster')
  })

  // ---- What is served ------------------------------------------------------

  it('serves derivatives only, never the original', async () => {
    const asset = await uploadPhoto()
    await attach(asset.id)

    const body = (await fetchListing()).json()
    // The whole response, not just the urls: the original's key is right there
    // in the asset row, and leaking it anywhere undoes the pipeline.
    expect(JSON.stringify(body)).not.toContain('original')
    for (const variant of body.media[0].variants) {
      expect(variant.url).toMatch(/^\/media\/[0-9a-f]+\/[a-z]+\.[a-z]+$/)
    }
  })

  it('leaves the bytes alone when a link is removed and another listing shares them', async () => {
    const file = await photograph({ width: 900, height: 600 })
    // Byte-identical, so the pipeline dedupes them to ONE asset row — which is
    // what makes this a shared-checksum test rather than two unrelated uploads.
    const a = (await upload(app, owner.headers, { file, filename: 'a.jpg', alt: 'Shared' })).json()
    const b = (await upload(app, owner.headers, { file, filename: 'b.jpg', alt: 'Shared' })).json()
    expect(b.id).toBe(a.id)

    const other = await seedListing(app.pg, { ownerId: owner.id, title: 'The other listing' })
    await attach(a.id)
    await attach(a.id, other)

    const removed = await app.inject({
      method: 'DELETE',
      url: `/marketplace/listings/${listingId}/media/${a.id}`,
      headers: owner.headers,
    })
    expect(removed.statusCode).toBe(200)

    // The link is gone from this listing...
    expect((await fetchListing()).json().media).toHaveLength(0)

    // ...and the counter-assertion, which is the whole point: the bytes are
    // still there, and the other listing still renders them.
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM assets WHERE id = $1', [a.id])
    expect(rows[0].n).toBe(1)
    const still = await app.inject({
      method: 'GET', url: `/marketplace/listings/${other}`, headers: owner.headers,
    })
    expect(still.json().media).toHaveLength(1)
  })

  // ---- The quota -----------------------------------------------------------

  it('charges the stored-byte quota for what a listing carries', async () => {
    const before = await storedBytes()
    const asset = await uploadPhoto()
    await attach(asset.id)
    const after = await storedBytes()

    // Attaching is a link; the BYTES were charged at upload. Asserting it here
    // is what stops a later "marketplace media is free" shortcut from going
    // unnoticed — one video can exceed a member's whole image allowance.
    expect(after).toBeGreaterThan(before)
  })

  const storedBytes = async () => {
    const { rows } = await app.pg.query(
      `SELECT coalesce(sum(used), 0)::bigint AS used FROM counters WHERE scope = 'media.stored_bytes'`,
    )
    return Number(rows[0].used)
  }

  // ---- Who may attach ------------------------------------------------------

  it("refuses to attach another member's asset, without confirming it exists", async () => {
    const stranger = await poster(app)
    const theirs = (await upload(app, stranger.headers, {
      file: await photograph({ width: 640, height: 480 }), filename: 's.jpg', alt: 'Theirs',
    })).json()

    const response = await attach(theirs.id)
    // 404, not 403 — the `guardOrganisationScope` precedent. A 403 would
    // confirm the asset id is real to someone guessing uuids.
    expect(response.statusCode).toBe(404)

    // Counter-assertion: the same member CAN attach their own, so this is not
    // a route that refuses everything.
    const mine = await uploadPhoto()
    expect((await attach(mine.id)).statusCode).toBe(201)
  })

  it("refuses to attach to another member's listing", async () => {
    const stranger = await poster(app)
    const asset = await uploadPhoto()
    const response = await attach(asset.id, listingId, stranger.headers)
    expect(response.statusCode).toBe(404)
  })

  it('refuses the same item twice on one listing', async () => {
    const asset = await uploadPhoto()
    expect((await attach(asset.id)).statusCode).toBe(201)

    // The primary key is (listing_id, position), so the schema alone would
    // happily store the same photo at 0 and at 1.
    expect((await attach(asset.id)).statusCode).toBe(400)
    expect((await fetchListing()).json().media).toHaveLength(1)
  })

  it('reports no media as an empty list, not a missing field', async () => {
    // A client that has to distinguish `undefined` from `[]` will get it wrong
    // on the listing that has no photos, which is the common case at first.
    expect((await fetchListing()).json().media).toEqual([])
  })
})
