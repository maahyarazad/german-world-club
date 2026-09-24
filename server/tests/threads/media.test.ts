import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, uploadPhoto, post, get, canonical, ABSENT } from './social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from './social-helpers.ts'

/** US1: a post with up to ten photos or videos (FR-001–FR-004, SC-002, SC-004). */
describe.skipIf(!hasDatabase)('posting with media (US1)', () => {
  let app: GwcApp
  let anna: Member
  let ben: Member

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna')
    ben = await member(app, 'Ben')
  })

  const postCount = async () => (await app.pg.query('SELECT count(*)::int AS n FROM thread_posts')).rows[0].n

  it('attaches the member\'s own photos in the order given, as derivatives with dimensions', async () => {
    const photos = [await uploadPhoto(app, anna.headers, { alt: 'one' }), await uploadPhoto(app, anna.headers, { alt: 'two' }), await uploadPhoto(app, anna.headers, { alt: 'three' })]
    const order = [photos[2]!, photos[0]!, photos[1]!]
    const response = await post(app, anna, { body: 'Dubai marina', media: order.map((p) => ({ assetId: p.id })) })

    expect(response.statusCode).toBe(201)
    const created = response.json()
    expect(created.media.map((m: { assetId: string }) => m.assetId)).toEqual(order.map((p) => p.id))
    for (const item of created.media) {
      expect(item.width).toBeGreaterThan(0)
      expect(item.height).toBeGreaterThan(0)
      expect(item.variants.length).toBeGreaterThan(0)
      for (const v of item.variants) {
        expect(v.url).toMatch(/^\/media\/[0-9a-f]+\/(thumb|small|medium|large)\./)
        expect(v.width).toBeGreaterThan(0)
      }
    }
    // The same post, read back by somebody else, carries the same media.
    const seen = (await get(app, ben, `/threads/posts/${created.id}`)).json()
    expect(seen.post.media).toHaveLength(3)
  })

  it('posts media without any text', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const response = await post(app, anna, { media: [{ assetId: photo.id }] })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ body: '', media: [expect.objectContaining({ assetId: photo.id })] })
  })

  it('refuses another member\'s asset exactly like an unknown one, and creates no post', async () => {
    const bens = await uploadPhoto(app, ben.headers)
    const before = await postCount()
    const stranger = await post(app, anna, { body: 'Mine now', media: [{ assetId: bens.id }] })
    const unknown = await post(app, anna, { body: 'Mine now', media: [{ assetId: ABSENT }] })
    expect(stranger.statusCode).toBe(404)
    expect(canonical(stranger)).toEqual(canonical(unknown))
    expect(await postCount()).toBe(before)
  })

  it('refuses an upload that is still processing, and creates no post (SC-004)', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    await app.pg.query(`UPDATE assets SET state = 'processing' WHERE id = $1`, [photo.id])
    const before = await postCount()
    const response = await post(app, anna, { body: 'Too soon', media: [{ assetId: photo.id }] })
    expect(response.statusCode).toBe(400)
    expect(await postCount()).toBe(before)
    // Counter-assertion: the same request succeeds once the asset is ready.
    await app.pg.query(`UPDATE assets SET state = 'ready' WHERE id = $1`, [photo.id])
    expect((await post(app, anna, { body: 'Now', media: [{ assetId: photo.id }] })).statusCode).toBe(201)
  })

  it('refuses eleven items and a duplicate', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const eleven = Array.from({ length: 11 }, () => ({ assetId: photo.id }))
    expect((await post(app, anna, { body: 'x', media: eleven })).statusCode).toBe(400)
    expect((await post(app, anna, { body: 'x', media: [{ assetId: photo.id }, { assetId: photo.id }] })).statusCode).toBe(400)
  })

  it('never references an original in any response (SC-002)', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const created = (await post(app, anna, { body: 'x', media: [{ assetId: photo.id }] })).json()
    const { rows } = await app.pg.query('SELECT storage_key FROM assets WHERE id = $1', [photo.id])
    const bodies = [
      JSON.stringify(created),
      (await get(app, ben, '/threads/feed?scope=all')).body,
      (await get(app, ben, `/threads/members/${anna.id}/posts?tab=media`)).body,
    ]
    for (const body of bodies) {
      expect(body).not.toContain(rows[0].storage_key)
      expect(body).not.toContain('original')
    }
    // Counter-assertion: the media really is in those responses.
    expect(bodies[1]).toContain(photo.id)
  })

  it('requires a handle to author, and succeeds once one is chosen', async () => {
    const newcomer = await member(app, 'Newcomer', { handle: null })
    const refused = await post(app, newcomer, { body: 'Hello' })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().type).toMatch(/handle-required$/)
    await app.inject({ method: 'PUT', url: '/profile/me/handle', headers: newcomer.headers, payload: { handle: 'newcomer' } })
    expect((await post(app, newcomer, { body: 'Hello' })).statusCode).toBe(201)
  })
})
