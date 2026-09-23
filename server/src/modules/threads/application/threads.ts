import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { VISIBLE_MEMBER } from '../../profile/application/profile.ts'
import type { GwcApp } from '../../../app.ts'
import type { FeedItem, FeedScope, ThreadPost } from '@gwc/contracts/threads'

/**
 * Threads, member side (§7). Staff moderation is `moderate.ts`.
 *
 * One visibility rule, applied in exactly one place (`VISIBLE_POST`): a post is
 * shown when it is `visible` and its author is a member other members may see.
 * A post by a member who was later locked disappears with them rather than
 * lingering under a name nobody can open.
 *
 * Everything else that is not shown answers 404 — hidden, removed, deleted,
 * or never existed — so a post id is not a way to learn what moderation did.
 */

const PAGE = 20

const VISIBLE_POST = `p.state = 'visible' AND ${VISIBLE_MEMBER}`

/**
 * The columns of a post as a member sees it, with counts computed live and
 * the viewer's own like/repost. `$1` is always the viewer.
 */
const POST_COLUMNS = `
  p.id, p.author_id, m.display_name AS author_name, p.body, p.reply_to_id, p.root_id, p.created_at,
  (SELECT count(*)::int FROM thread_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT count(*)::int FROM thread_posts c WHERE c.reply_to_id = p.id AND c.state = 'visible') AS reply_count,
  (SELECT count(*)::int FROM thread_reposts r WHERE r.post_id = p.id) AS repost_count,
  EXISTS (SELECT 1 FROM thread_likes l WHERE l.post_id = p.id AND l.member_id = $1) AS liked_by_me,
  EXISTS (SELECT 1 FROM thread_reposts r WHERE r.post_id = p.id AND r.member_id = $1) AS reposted_by_me`

type Row = Record<string, any>

function toPost(row: Row, viewerId: string): ThreadPost {
  return {
    id: String(row.id),
    author: { id: String(row.author_id), displayName: row.author_name ?? null },
    body: String(row.body),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    rootId: row.root_id ? String(row.root_id) : null,
    createdAt: new Date(row.created_at).toISOString(),
    likeCount: row.like_count,
    replyCount: row.reply_count,
    repostCount: row.repost_count,
    likedByMe: row.liked_by_me,
    repostedByMe: row.reposted_by_me,
    isMine: String(row.author_id) === viewerId,
  }
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function decodeCursor<T>(cursor: string | undefined, valid: (v: any) => boolean): T | null {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return valid(parsed) ? parsed : null
  } catch {
    // Opaque to the client; a mangled one is the first page, not an error.
    return null
  }
}

type FeedCursor = { a: string; p: string; r: string }
export const isFeedCursor = (v: any) => typeof v?.a === 'string' && typeof v?.p === 'string' && typeof v?.r === 'string'

/**
 * The feed: posts and reposts as *entries*, newest activity first.
 *
 * `following` is your own posts, the posts of people you follow, and what they
 * reposted — at the moment they reposted it, which is what puts an old post
 * back at the top of the feed. `all` is every top-level post, originals only:
 * without a follow graph to scope them, reposts would only be duplicates.
 *
 * The keyset is (activity, post, reposter). The reposter is part of it because
 * two people you follow can repost the same post in the same instant, and a
 * keyset that is not unique skips rows at page boundaries.
 */
export async function loadFeed(
  app: GwcApp,
  { viewerId, scope, cursor, signal }:
    { viewerId: string; scope: FeedScope; cursor: FeedCursor | null; signal?: AbortSignal },
): Promise<{ items: FeedItem[]; nextCursor: string | null }> {
  const following = `SELECT followee_id FROM member_follows WHERE follower_id = $1`
  const entries = scope === 'following'
    ? `SELECT p.id AS post_id, NULL::uuid AS reposter_id, p.created_at AS activity_at
         FROM thread_posts p
        WHERE p.reply_to_id IS NULL AND (p.author_id = $1 OR p.author_id IN (${following}))
       UNION ALL
       SELECT r.post_id, r.member_id, r.created_at
         FROM thread_reposts r
        WHERE r.member_id IN (${following})`
    : `SELECT p.id AS post_id, NULL::uuid AS reposter_id, p.created_at AS activity_at
         FROM thread_posts p
        WHERE p.reply_to_id IS NULL`

  const params: unknown[] = [viewerId, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.a, cursor.p, cursor.r)
    keyset = `AND (e.activity_at, p.id, COALESCE(e.reposter_id::text, ''))
                  < ($3::timestamptz, $4::uuid, $5::text)`
  }

  const { rows } = await query(
    app.pg,
    `WITH entries AS (${entries})
     SELECT ${POST_COLUMNS},
            e.activity_at, e.reposter_id, rm.display_name AS reposter_name
       FROM entries e
       JOIN thread_posts p ON p.id = e.post_id
       JOIN members m ON m.id = p.author_id
       LEFT JOIN members rm ON rm.id = e.reposter_id
      WHERE ${VISIBLE_POST}
        AND (e.reposter_id IS NULL OR rm.status = 'active')
        ${keyset}
      ORDER BY e.activity_at DESC, p.id DESC, COALESCE(e.reposter_id::text, '') DESC
      LIMIT $2`,
    params,
    { signal },
  )

  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    items: page.map((row) => ({
      post: toPost(row, viewerId),
      repostedBy: row.reposter_id ? { id: String(row.reposter_id), displayName: row.reposter_name ?? null } : null,
      activityAt: new Date(row.activity_at).toISOString(),
    })),
    nextCursor: rows.length > PAGE && last
      ? encode({ a: new Date(last.activity_at).toISOString(), p: String(last.id), r: last.reposter_id ? String(last.reposter_id) : '' })
      : null,
  }
}

type PostCursor = { c: string; p: string }
export const isPostCursor = (v: any) => typeof v?.c === 'string' && typeof v?.p === 'string'

/** A member's own top-level posts, newest first — their profile's thread list. */
export async function loadMemberPosts(
  app: GwcApp,
  { viewerId, authorId, cursor, signal }:
    { viewerId: string; authorId: string; cursor: PostCursor | null; signal?: AbortSignal },
) {
  const params: unknown[] = [viewerId, authorId, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.c, cursor.p)
    keyset = 'AND (p.created_at, p.id) < ($4::timestamptz, $5::uuid)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT ${POST_COLUMNS}
       FROM thread_posts p
       JOIN members m ON m.id = p.author_id
      WHERE p.author_id = $2 AND p.reply_to_id IS NULL AND ${VISIBLE_POST} ${keyset}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $3`,
    params,
    { signal },
  )
  return paginatePosts(rows, viewerId)
}

function paginatePosts(rows: Row[], viewerId: string) {
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    items: page.map((row) => toPost(row, viewerId)),
    nextCursor: rows.length > PAGE && last
      ? encode({ c: new Date(last.created_at).toISOString(), p: String(last.id) })
      : null,
  }
}

async function loadVisiblePost(app: GwcApp, viewerId: string, postId: string, signal?: AbortSignal) {
  const { rows } = await query(
    app.pg,
    `SELECT ${POST_COLUMNS}
       FROM thread_posts p
       JOIN members m ON m.id = p.author_id
      WHERE p.id = $2 AND ${VISIBLE_POST}`,
    [viewerId, postId],
    { signal },
  )
  return rows[0] ?? null
}

const notFound = () => refuse(PROBLEMS.NOT_FOUND, 'No such post.')

/**
 * A post in context: what it answers, and its direct replies, oldest first so
 * a conversation reads top to bottom. Deeper replies are one tap further —
 * each reply is itself a thread view.
 */
export async function loadThread(
  app: GwcApp,
  { viewerId, postId, cursor, signal }:
    { viewerId: string; postId: string; cursor: PostCursor | null; signal?: AbortSignal },
) {
  const post = await loadVisiblePost(app, viewerId, postId, signal)
  if (!post) throw notFound()

  // The parent may have been moderated since; the reply still stands, but
  // shows what it answered only while that is itself visible.
  const parent = post.reply_to_id ? await loadVisiblePost(app, viewerId, String(post.reply_to_id), signal) : null

  const params: unknown[] = [viewerId, postId, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.c, cursor.p)
    keyset = 'AND (p.created_at, p.id) > ($4::timestamptz, $5::uuid)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT ${POST_COLUMNS}
       FROM thread_posts p
       JOIN members m ON m.id = p.author_id
      WHERE p.reply_to_id = $2 AND ${VISIBLE_POST} ${keyset}
      ORDER BY p.created_at ASC, p.id ASC
      LIMIT $3`,
    params,
    { signal },
  )
  const replies = paginatePosts(rows, viewerId)
  return {
    post: toPost(post, viewerId),
    parent: parent ? toPost(parent, viewerId) : null,
    replies: replies.items,
    nextCursor: replies.nextCursor,
  }
}

export async function createPost(
  app: GwcApp,
  { authorId, body, replyToId, requestId, signal }:
    { authorId: string; body: string; replyToId?: string; requestId?: string; signal?: AbortSignal },
) {
  let rootId: string | null = null
  if (replyToId) {
    // Answering something you cannot see is refused like it does not exist.
    const parent = await loadVisiblePost(app, authorId, replyToId, signal)
    if (!parent) throw notFound()
    rootId = parent.root_id ? String(parent.root_id) : String(parent.id)
  }

  const { rows } = await query(
    app.pg,
    `INSERT INTO thread_posts (author_id, body, reply_to_id, root_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [authorId, body, replyToId ?? null, rootId],
    { signal },
  )
  const postId = String(rows[0]!.id)
  await app.audit({
    action: 'thread_post_created', outcome: 'allowed', requestId,
    actorId: authorId, actorKind: 'member', targetType: 'thread_post', targetId: postId,
  })
  return toPost((await loadVisiblePost(app, authorId, postId, signal))!, authorId)
}

/**
 * The author withdraws their own post. `deleted` is final (024_threads.sql),
 * and replies to it stay — they belong to the people who wrote them.
 */
export async function deleteOwnPost(
  app: GwcApp,
  { authorId, postId, requestId, signal }: { authorId: string; postId: string; requestId?: string; signal?: AbortSignal },
) {
  const { rowCount } = await query(
    app.pg,
    `UPDATE thread_posts SET state = 'deleted' WHERE id = $1 AND author_id = $2 AND state = 'visible'`,
    [postId, authorId],
    { signal },
  )
  // Somebody else's post answers exactly like a missing one.
  if (rowCount === 0) throw notFound()
  await app.audit({
    action: 'thread_post_deleted', outcome: 'allowed', requestId,
    actorId: authorId, actorKind: 'member', targetType: 'thread_post', targetId: postId,
  })
}

/**
 * Like or repost, on or off. Idempotent both ways: the primary key makes a
 * second like a no-op, and removing one that is not there is not an error —
 * a client retrying after a dropped connection must land where it meant to.
 */
export async function setReaction(
  app: GwcApp,
  { memberId, postId, kind, on, signal }:
    { memberId: string; postId: string; kind: 'like' | 'repost'; on: boolean; signal?: AbortSignal },
) {
  if (!(await loadVisiblePost(app, memberId, postId, signal))) throw notFound()
  const table = kind === 'like' ? 'thread_likes' : 'thread_reposts'
  await query(
    app.pg,
    on
      ? `INSERT INTO ${table} (post_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
      : `DELETE FROM ${table} WHERE post_id = $1 AND member_id = $2`,
    [postId, memberId],
    { signal },
  )
  return toPost((await loadVisiblePost(app, memberId, postId, signal))!, memberId)
}

export async function reportPost(
  app: GwcApp,
  { memberId, postId, reason, requestId, signal }:
    { memberId: string; postId: string; reason: string; requestId?: string; signal?: AbortSignal },
) {
  if (!(await loadVisiblePost(app, memberId, postId, signal))) throw notFound()
  try {
    await query(
      app.pg,
      'INSERT INTO thread_reports (post_id, reporter_id, reason) VALUES ($1, $2, $3)',
      [postId, memberId, reason],
      { signal },
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw refuse(PROBLEMS.CONFLICT, 'You have already reported this post.')
    }
    throw err
  }
  await app.audit({
    action: 'thread_post_reported', outcome: 'allowed', requestId,
    actorId: memberId, actorKind: 'member', targetType: 'thread_post', targetId: postId,
  })
}

/**
 * Follow or unfollow. Following needs nobody's consent (it is not a contact),
 * but only a member you could see may be followed — the same 404 as their
 * profile, so the follow endpoint is not a second way to probe accounts.
 */
export async function setFollow(
  app: GwcApp,
  { followerId, followeeId, on, signal }:
    { followerId: string; followeeId: string; on: boolean; signal?: AbortSignal },
) {
  if (followerId === followeeId) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'You cannot follow yourself.')
  }
  return withTransaction(app.pg, async (client) => {
    const { rows: visible } = await client.query(
      `SELECT 1 FROM members m WHERE m.id = $1 AND ${VISIBLE_MEMBER}`,
      [followeeId],
    )
    if (visible.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
    await client.query(
      on
        ? 'INSERT INTO member_follows (follower_id, followee_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
        : 'DELETE FROM member_follows WHERE follower_id = $1 AND followee_id = $2',
      [followerId, followeeId],
    )
    const { rows } = await client.query(
      'SELECT count(*)::int AS followers FROM member_follows WHERE followee_id = $1',
      [followeeId],
    )
    return { following: on, followers: rows[0].followers as number }
  }, { signal })
}
