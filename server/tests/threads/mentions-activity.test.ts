import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, post, get } from './social-helpers.ts'
import { parseMentions } from '../../src/modules/threads/application/mentions.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from './social-helpers.ts'

describe('mention parsing (FR-006)', () => {
  it('finds handles, not email addresses, and drops sentence punctuation', () => {
    expect(parseMentions('Thanks @Anna. and @ben_b, not anna@example.org')).toEqual(['anna', 'ben_b'])
  })
  it('keeps the first twenty distinct handles', () => {
    const body = Array.from({ length: 25 }, (_, i) => `@user${i}`).join(' ') + ' @user0'
    expect(parseMentions(body)).toHaveLength(20)
    expect(parseMentions(body)[19]).toBe('user19')
  })
})

/** US5: mentions and Activity, computed on read (FR-006, FR-009). */
describe.skipIf(!hasDatabase)('mentions and activity (US5)', () => {
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

  const activity = async (who: Member) => (await get(app, who, '/threads/activity')).json()
  const unread = async (who: Member) => (await get(app, who, '/threads/activity/unread')).json().unread

  it('records a mention by member, and it survives a handle change', async () => {
    const created = (await post(app, anna, { body: `Hello @${ben.handle!.toUpperCase()} and @nobody_here` })).json()
    expect(created.mentions).toEqual([{ memberId: ben.id, handle: ben.handle }])
    expect(created.body).toContain('@nobody_here')

    await app.pg.query(`UPDATE members SET handle = 'ben.renamed' WHERE id = $1`, [ben.id])
    const reread = (await get(app, anna, `/threads/posts/${created.id}`)).json().post
    expect(reread.mentions.map((m: { memberId: string }) => m.memberId)).toEqual([ben.id])
  })

  it('does not record a mention across a block, or of a locked member', async () => {
    await app.inject({ method: 'PUT', url: `/threads/blocks/${anna.id}`, headers: ben.headers })
    expect((await post(app, anna, { body: `Hi @${ben.handle}` })).json().mentions).toEqual([])
    await app.inject({ method: 'DELETE', url: `/threads/blocks/${anna.id}`, headers: ben.headers })
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [ben.id])
    expect((await post(app, anna, { body: `Hi @${ben.handle}` })).json().mentions).toEqual([])
  })

  it('lists every kind of activity, newest first, and never your own actions', async () => {
    const mine = (await post(app, anna, { body: 'Mine' })).json()
    await app.inject({ method: 'PUT', url: `/threads/follows/${anna.id}`, headers: ben.headers })
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/like`, headers: ben.headers })
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/repost`, headers: ben.headers })
    await post(app, ben, { body: 'Reply', replyToId: mine.id })
    await post(app, ben, { body: 'Quote', quoteOfId: mine.id })
    await post(app, ben, { body: `Hey @${anna.handle}` })
    // Her own like produces nothing.
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/like`, headers: anna.headers })

    const page = await activity(anna)
    expect(page.items.map((i: { kind: string }) => i.kind).sort()).toEqual(['follow', 'like', 'mention', 'quote', 'reply', 'repost'])
    expect(page.items.every((i: { actor: { id: string } }) => i.actor.id === ben.id)).toBe(true)
    const times = page.items.map((i: { at: string }) => i.at)
    expect([...times].sort().reverse()).toEqual(times)
    expect(page.unread).toBe(6)
  })

  it('is computed: an unlike removes the item', async () => {
    const mine = (await post(app, anna, { body: 'Mine' })).json()
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/like`, headers: ben.headers })
    expect((await activity(anna)).items).toHaveLength(1)
    await app.inject({ method: 'DELETE', url: `/threads/posts/${mine.id}/like`, headers: ben.headers })
    expect((await activity(anna)).items).toHaveLength(0)
  })

  it('drops items from actors since locked or blocked, and on hidden posts', async () => {
    const mine = (await post(app, anna, { body: 'Mine' })).json()
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/like`, headers: ben.headers })
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [ben.id])
    expect((await activity(anna)).items).toHaveLength(0)
    await app.pg.query(`UPDATE members SET status = 'active' WHERE id = $1`, [ben.id])
    expect((await activity(anna)).items).toHaveLength(1)
    await app.pg.query(`UPDATE thread_posts SET state = 'hidden', state_reason = 'Review' WHERE id = $1`, [mine.id])
    expect((await activity(anna)).items).toHaveLength(0)
  })

  it('clears unread on seen, and an older boundary never moves it back', async () => {
    const mine = (await post(app, anna, { body: 'Mine' })).json()
    await app.inject({ method: 'PUT', url: `/threads/posts/${mine.id}/like`, headers: ben.headers })
    expect(await unread(anna)).toBe(1)
    const seen = (upTo: string) => app.inject({ method: 'POST', url: '/threads/activity/seen', headers: anna.headers, payload: { upTo } })
    expect((await seen(new Date().toISOString())).statusCode).toBe(204)
    expect(await unread(anna)).toBe(0)
    await seen('2000-01-01T00:00:00.000Z')
    expect(await unread(anna)).toBe(0)
  })
})
