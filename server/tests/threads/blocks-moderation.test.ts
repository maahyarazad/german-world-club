import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, staff, uploadPhoto, post, get, canonical, ABSENT } from './social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from './social-helpers.ts'

/** US8: block and mute; US7: staff see media on posts they judge. */
describe.skipIf(!hasDatabase)('blocks, mutes and moderation (US7, US8)', () => {
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

  const put = (who: Member, url: string) => app.inject({ method: 'PUT', url, headers: who.headers })

  it('makes a block mutual invisibility and ends follows both ways in one step', async () => {
    const annas = (await post(app, anna, { body: 'Anna here' })).json()
    await put(anna, `/threads/follows/${ben.id}`)
    await put(ben, `/threads/follows/${anna.id}`)
    const follows = async () => (await app.pg.query('SELECT count(*)::int AS n FROM member_follows')).rows[0].n
    expect(await follows()).toBe(2)

    expect((await put(anna, `/threads/blocks/${ben.id}`)).json()).toEqual({ blocked: true })
    expect(await follows()).toBe(0)

    // Ben: Anna's profile, posts, likes and quotes are the same 404 as nothing.
    expect(canonical(await get(app, ben, `/profile/members/${anna.id}`))).toEqual(canonical(await get(app, ben, `/profile/members/${ABSENT}`)))
    expect((await get(app, ben, `/threads/posts/${annas.id}`)).statusCode).toBe(404)
    expect((await put(ben, `/threads/posts/${annas.id}/like`)).statusCode).toBe(404)
    expect((await post(app, ben, { body: 'q', quoteOfId: annas.id })).statusCode).toBe(404)
    expect((await put(ben, `/threads/follows/${anna.id}`)).statusCode).toBe(404)

    // Anna can still open Ben's profile — to unblock him — but not his posts.
    const bensProfile = await get(app, anna, `/profile/members/${ben.id}`)
    expect(bensProfile.json()).toMatchObject({ isBlocked: true })
    expect((await get(app, anna, `/threads/members/${ben.id}/posts`)).statusCode).toBe(404)

    // Unblocking restores visibility, not the follows.
    await app.inject({ method: 'DELETE', url: `/threads/blocks/${ben.id}`, headers: anna.headers })
    expect((await get(app, ben, `/threads/posts/${annas.id}`)).statusCode).toBe(200)
    expect(await follows()).toBe(0)
  })

  it('makes a mute curation only', async () => {
    const bens = (await post(app, ben, { body: 'Ben here' })).json()
    const feed = async () => (await get(app, anna, '/threads/feed?scope=all')).json().items.map((i: { post: { id: string } }) => i.post.id)
    expect(await feed()).toContain(bens.id)
    expect((await put(anna, `/threads/mutes/${ben.id}`)).json()).toEqual({ muted: true })
    expect(await feed()).not.toContain(bens.id)
    expect((await get(app, anna, `/threads/posts/${bens.id}`)).statusCode).toBe(200)
    expect((await get(app, anna, '/threads/mutes')).json().items.map((a: { id: string }) => a.id)).toEqual([ben.id])
  })

  it('shows staff a hidden post with its media; members get 404', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const annas = (await post(app, anna, { body: 'Borderline', media: [{ assetId: photo.id }] })).json()
    const moderator = await staff(app, { threads_moderation: { read: true, status: true } })
    const hidden = await app.inject({
      method: 'POST', url: `/admin/threads/posts/${annas.id}/hide`, headers: moderator.headers, payload: { reason: 'Under review' },
    })
    expect(hidden.statusCode).toBe(200)
    expect(hidden.json()).toMatchObject({ state: 'hidden', media: [expect.objectContaining({ assetId: photo.id })] })
    expect((await get(app, ben, `/threads/posts/${annas.id}`)).statusCode).toBe(404)

    const nobody = await staff(app, {})
    expect((await app.inject({ method: 'GET', url: `/admin/threads/posts/${annas.id}`, headers: nobody.headers })).statusCode).toBe(403)
  })
})
