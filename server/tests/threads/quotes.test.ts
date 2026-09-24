import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, uploadPhoto, post, get } from './social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from './social-helpers.ts'

/**
 * US2: quotes, replies with media, likers (FR-005, SC-005).
 *
 * The central assertion is SC-005: once a quoted post is no longer visible,
 * NOTHING of it — body, author, media — is in the quoting post's response.
 */
describe.skipIf(!hasDatabase)('quotes and conversation (US2)', () => {
  let app: GwcApp
  let anna: Member
  let ben: Member
  let carl: Member

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna')
    ben = await member(app, 'Ben')
    carl = await member(app, 'Carl')
  })

  const SECRET = 'A very distinctive sentence about falcons'

  async function quotedSetup() {
    const photo = await uploadPhoto(app, anna.headers)
    const original = (await post(app, anna, { body: SECRET, media: [{ assetId: photo.id }] })).json()
    const quote = (await post(app, ben, { body: 'Look at this', quoteOfId: original.id })).json()
    return { original, quote, photo }
  }

  it('embeds the live quoted post and counts the quote', async () => {
    const { original, quote } = await quotedSetup()
    expect(quote.quoted).toMatchObject({ unavailable: false, post: { id: original.id, body: SECRET } })
    expect((await get(app, carl, `/threads/posts/${original.id}`)).json().post.quoteCount).toBe(1)
    const quotes = (await get(app, carl, `/threads/posts/${original.id}/quotes`)).json()
    expect(quotes.items.map((p: { id: string }) => p.id)).toEqual([quote.id])
  })

  it.each([
    ['hidden by staff', `UPDATE thread_posts SET state = 'hidden', state_reason = 'Under review' WHERE id = $1`],
    ['removed by staff', `UPDATE thread_posts SET state = 'removed', state_reason = 'Rule 3' WHERE id = $1`],
    ['deleted by its author', `UPDATE thread_posts SET state = 'deleted' WHERE id = $1`],
    ['by a member since locked', `UPDATE members SET status = 'locked' WHERE id = (SELECT author_id FROM thread_posts WHERE id = $1)`],
  ])('shows a tombstone carrying nothing of a post %s (SC-005)', async (_label, sql) => {
    const { original, quote, photo } = await quotedSetup()
    // Counter-assertion first: before, the quoted body IS present.
    expect((await get(app, carl, `/threads/posts/${quote.id}`)).body).toContain(SECRET)

    await app.pg.query(sql, [original.id])
    const response = await get(app, carl, `/threads/posts/${quote.id}`)
    expect(response.statusCode).toBe(200)
    expect(response.json().post.quoted).toEqual({ unavailable: true })
    for (const leak of [SECRET, anna.id, photo.id, anna.handle!]) expect(response.body).not.toContain(leak)
  })

  it('refuses quoting a post that is not visible, and quoting while replying', async () => {
    const { original } = await quotedSetup()
    expect((await post(app, carl, { body: 'x', replyToId: original.id, quoteOfId: original.id })).statusCode).toBe(400)
    await app.pg.query(`UPDATE thread_posts SET state = 'deleted' WHERE id = $1`, [original.id])
    expect((await post(app, carl, { body: 'x', quoteOfId: original.id })).statusCode).toBe(404)
  })

  it('replies with media, keeps the root, and lists likers once each', async () => {
    const root = (await post(app, anna, { body: 'Root' })).json()
    const photo = await uploadPhoto(app, ben.headers)
    const reply = (await post(app, ben, { body: 'Reply', replyToId: root.id, media: [{ assetId: photo.id }] })).json()
    expect(reply).toMatchObject({ replyToId: root.id, rootId: root.id, media: [expect.objectContaining({ assetId: photo.id })] })

    for (let i = 0; i < 2; i += 1) {
      await app.inject({ method: 'PUT', url: `/threads/posts/${root.id}/like`, headers: carl.headers })
    }
    const likers = (await get(app, anna, `/threads/posts/${root.id}/likes`)).json()
    expect(likers.items).toEqual([expect.objectContaining({ id: carl.id, handle: carl.handle })])
  })
})
