import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, createAdmin, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Threads (§7) and its moderation (§8).
 *
 * The recurring assertion is indistinguishability: a hidden, removed or
 * deleted post, a post by a locked member, and a post that never existed all
 * answer the same 404 — a post id must not be a way to learn what moderation
 * did or what state somebody's account is in.
 */
describe.skipIf(!hasDatabase)('threads (§7)', () => {
  let app: GwcApp
  let alice: { id: string; headers: Record<string, string> }
  let bob: { id: string; headers: Record<string, string> }

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  const memberWithBearer = async (displayName: string) => {
    const row = await createMember(app.pg, { displayName })
    return { id: String(row.id), headers: await bearerFor(app, { accountId: String(row.id), accountKind: 'member' }) }
  }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    alice = await memberWithBearer('Alice')
    bob = await memberWithBearer('Bob')
  })

  const post = (headers: Record<string, string>, body: string, replyToId?: string) =>
    app.inject({ method: 'POST', url: '/threads/posts', headers, payload: { body, ...(replyToId ? { replyToId } : {}) } })
  const view = (headers: Record<string, string>, id: string) =>
    app.inject({ method: 'GET', url: `/threads/posts/${id}`, headers })
  const feed = (headers: Record<string, string>, scope = 'following') =>
    app.inject({ method: 'GET', url: `/threads/feed?scope=${scope}`, headers })
  const ABSENT = '00000000-0000-0000-0000-000000000000'
  const canonical = (r: { statusCode: number; json: () => Record<string, unknown> }) => ({ status: r.statusCode, body: { ...r.json(), instance: null, requestId: null } })

  it('posts, and a reply knows its root however deep it is', async () => {
    const root = (await post(alice.headers, 'Hello club')).json()
    const reply = (await post(bob.headers, 'Hi Alice', root.id)).json()
    const deeper = (await post(alice.headers, 'Hi Bob', reply.id)).json()

    expect(deeper).toMatchObject({ replyToId: reply.id, rootId: root.id })
    const thread = (await view(bob.headers, root.id)).json()
    expect(thread.post.replyCount).toBe(1)
    expect(thread.replies.map((p: { id: string }) => p.id)).toEqual([reply.id])
  })

  it('refuses an empty post and one over the length limit', async () => {
    expect((await post(alice.headers, '   ')).statusCode).toBe(400)
    expect((await post(alice.headers, 'x'.repeat(501))).statusCode).toBe(400)
    expect((await post(alice.headers, 'x'.repeat(500))).statusCode).toBe(201)
  })

  it('builds the following feed from you, who you follow, and what they repost', async () => {
    const carol = await memberWithBearer('Carol')
    const bobs = (await post(bob.headers, 'Bob here')).json()
    const carols = (await post(carol.headers, 'Carol here')).json()

    // Not following anybody yet: Alice sees nothing of theirs.
    expect((await feed(alice.headers)).json().items).toEqual([])

    await app.inject({ method: 'PUT', url: `/threads/follows/${bob.id}`, headers: alice.headers })
    await app.inject({ method: 'PUT', url: `/threads/posts/${carols.id}/repost`, headers: bob.headers })

    const items = (await feed(alice.headers)).json().items
    expect(items.map((i: { post: { id: string }; repostedBy: { id: string } | null }) => [i.post.id, i.repostedBy?.id ?? null]))
      .toEqual([[carols.id, bob.id], [bobs.id, null]])
    // `all` shows every top-level post, originals only.
    expect((await feed(alice.headers, 'all')).json().items).toHaveLength(2)
  })

  it('pages the feed without skipping or repeating', async () => {
    for (let i = 0; i < 25; i += 1) await post(alice.headers, `post ${i}`)
    const first = (await feed(alice.headers)).json()
    const second = (await app.inject({
      method: 'GET', url: `/threads/feed?scope=following&cursor=${first.nextCursor}`, headers: alice.headers,
    })).json()
    const ids = [...first.items, ...second.items].map((i: { post: { id: string } }) => i.post.id)
    expect(ids).toHaveLength(25)
    expect(new Set(ids).size).toBe(25)
    expect(second.nextCursor).toBeNull()
  })

  it('makes likes idempotent in both directions', async () => {
    const p = (await post(bob.headers, 'Like me')).json()
    const like = () => app.inject({ method: 'PUT', url: `/threads/posts/${p.id}/like`, headers: alice.headers })
    await like()
    const twice = (await like()).json()
    expect(twice).toMatchObject({ likeCount: 1, likedByMe: true })

    const unlike = () => app.inject({ method: 'DELETE', url: `/threads/posts/${p.id}/like`, headers: alice.headers })
    await unlike()
    expect((await unlike()).json()).toMatchObject({ likeCount: 0, likedByMe: false })
  })

  it('lets an author delete their own post, and answers anybody else like a missing post', async () => {
    const p = (await post(alice.headers, 'Mine')).json()
    const byBob = await app.inject({ method: 'DELETE', url: `/threads/posts/${p.id}`, headers: bob.headers })
    const absent = await app.inject({ method: 'DELETE', url: `/threads/posts/${ABSENT}`, headers: bob.headers })
    expect(canonical(byBob)).toEqual(canonical(absent))

    expect((await app.inject({ method: 'DELETE', url: `/threads/posts/${p.id}`, headers: alice.headers })).statusCode).toBe(204)
    expect((await view(alice.headers, p.id)).statusCode).toBe(404)
  })

  it('hides a locked member\'s posts exactly as if they did not exist', async () => {
    const p = (await post(bob.headers, 'Soon locked')).json()
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [bob.id])
    expect(canonical(await view(alice.headers, p.id))).toEqual(canonical(await view(alice.headers, ABSENT)))
    expect((await feed(alice.headers, 'all')).json().items).toEqual([])
  })

  it('refuses a duplicate report', async () => {
    const p = (await post(bob.headers, 'Reportable')).json()
    const report = () => app.inject({ method: 'POST', url: `/threads/posts/${p.id}/report`, headers: alice.headers, payload: { reason: 'Spam content' } })
    expect((await report()).statusCode).toBe(202)
    expect((await report()).statusCode).toBe(409)
  })

  it('refuses following yourself', async () => {
    expect((await app.inject({ method: 'PUT', url: `/threads/follows/${alice.id}`, headers: alice.headers })).statusCode).toBe(400)
  })

  describe('staff moderation (§8)', () => {
    let staff: Record<string, string>
    beforeEach(async () => {
      const admin = await createAdmin(app.pg, { grants: { threads_moderation: { read: true, status: true, delete: true } } })
      app.permissions.invalidateAll?.()
      staff = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
    })

    const moderate = (id: string, action: string, reason = 'Breaks the house rules') =>
      app.inject({ method: 'POST', url: `/admin/threads/posts/${id}/${action}`, headers: staff, payload: { reason } })

    it('hides and restores, and a hidden post answers members like a missing one', async () => {
      const p = (await post(bob.headers, 'Borderline')).json()
      expect((await moderate(p.id, 'hide')).json().state).toBe('hidden')
      expect(canonical(await view(alice.headers, p.id))).toEqual(canonical(await view(alice.headers, ABSENT)))

      expect((await moderate(p.id, 'restore')).json().state).toBe('visible')
      expect((await view(alice.headers, p.id)).statusCode).toBe(200)
    })

    it('makes removal final', async () => {
      const p = (await post(bob.headers, 'Over the line')).json()
      await moderate(p.id, 'remove')
      expect((await moderate(p.id, 'restore')).statusCode).toBe(409)
    })

    it('requires a reason and writes it to the audit log', async () => {
      const p = (await post(bob.headers, 'Needs a reason')).json()
      expect((await moderate(p.id, 'hide', '')).statusCode).toBe(400)
      await moderate(p.id, 'hide', 'Off topic for the club')
      const { rows } = await app.pg.query(
        `SELECT detail->>'reason' AS reason FROM audit_log WHERE action = 'thread_post_hide' AND target_id = $1`, [p.id],
      )
      expect(rows.map((r) => r.reason)).toEqual(['Off topic for the club'])
    })

    it('cannot rewrite what a member said — not through the API, not through SQL', async () => {
      const p = (await post(bob.headers, 'Original words')).json()
      await expect(app.pg.query(`UPDATE thread_posts SET body = 'Edited by staff' WHERE id = $1`, [p.id]))
        .rejects.toThrow(/not edited/)
    })
  })
})
