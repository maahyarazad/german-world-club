import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, uploadPhoto, post, get, canonical } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from '../threads/social-helpers.ts'

/** US3/US4: profiles by id and by handle, tabs, followers (FR-008, FR-016). */
describe.skipIf(!hasDatabase)('member profiles, tabs and following (US3, US4)', () => {
  let app: GwcApp
  let anna: Member
  let ben: Member

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna', { mobile: '+4917099999999' })
    ben = await member(app, 'Ben')
  })

  it('answers by handle exactly as by id, without contact details', async () => {
    const byId = await get(app, ben, `/profile/members/${anna.id}`)
    const byHandle = await get(app, ben, `/profile/handles/${anna.handle!.toUpperCase()}`)
    expect(byHandle.json()).toEqual(byId.json())
    expect(byId.body).not.toContain(anna.email)
    expect(byId.body).not.toContain('4917099999999')
    expect(byId.json()).toMatchObject({ handle: anna.handle, isInfluencer: false, isBlocked: false })
  })

  it('answers a locked member by handle like one who never existed', async () => {
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [anna.id])
    expect(canonical(await get(app, ben, `/profile/handles/${anna.handle}`)))
      .toEqual(canonical(await get(app, ben, '/profile/handles/nobody.here')))
  })

  it('splits a member\'s posts into four tabs', async () => {
    const photo = await uploadPhoto(app, anna.headers)
    const top = (await post(app, anna, { body: 'Top' })).json()
    const withMedia = (await post(app, anna, { body: 'Pic', media: [{ assetId: photo.id }] })).json()
    const bens = (await post(app, ben, { body: 'Ben posts' })).json()
    const reply = (await post(app, anna, { body: 'Reply', replyToId: bens.id })).json()
    await app.inject({ method: 'PUT', url: `/threads/posts/${bens.id}/repost`, headers: anna.headers })

    const tab = async (name?: string) =>
      (await get(app, ben, `/threads/members/${anna.id}/posts${name ? `?tab=${name}` : ''}`)).json().items.map((p: { id: string }) => p.id)
    expect(await tab()).toEqual([withMedia.id, top.id])
    expect(await tab('threads')).toEqual([withMedia.id, top.id])
    expect(await tab('replies')).toEqual([reply.id])
    expect(await tab('media')).toEqual([withMedia.id])
    expect(await tab('reposts')).toEqual([bens.id])
  })

  it('lists followers and following, and following puts their posts in your feed', async () => {
    const bensPost = (await post(app, ben, { body: 'From Ben' })).json()
    const feed = async () => (await get(app, anna, '/threads/feed?scope=following')).json().items.map((i: { post: { id: string } }) => i.post.id)
    expect(await feed()).not.toContain(bensPost.id)

    await app.inject({ method: 'PUT', url: `/threads/follows/${ben.id}`, headers: anna.headers })
    expect(await feed()).toContain(bensPost.id)
    expect((await get(app, anna, `/threads/members/${ben.id}/followers`)).json().items.map((a: { id: string }) => a.id)).toEqual([anna.id])
    expect((await get(app, ben, `/threads/members/${anna.id}/following`)).json().items.map((a: { id: string }) => a.id)).toEqual([ben.id])
  })
})
