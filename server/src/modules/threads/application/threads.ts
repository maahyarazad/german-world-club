import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { visibleMemberAs, notBlockedBetween } from '../../profile/application/profile.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'
import type {
  FeedItem, FeedScope, ProfileTab, ThreadAuthor, ThreadPost, ThreadPostSummary,
} from '@gwc/contracts/threads'
import type { MediaItem } from '@gwc/contracts/media'

/**
 * Threads, member side (§7). Staff moderation is `moderate.ts`; creating a
 * post is `compose.ts`, Activity `activity.ts`, blocks and mutes
 * `relations.ts`.
 *
 * One visibility rule, applied in exactly one place (`VISIBLE_POST`): a post is
 * shown when it is `visible`, its author is a member other members may see,
 * and neither the viewer nor the author has blocked the other. A post by a
 * member who was later locked disappears with them rather than lingering under
 * a name nobody can open. Quotes, reply lists, profile tabs, Activity and
 * mention resolution all use this same constant — a second copy is how a
 * hidden post comes back through a side door.
 *
 * Everything else that is not shown answers 404 — hidden, removed, deleted,
 * blocked, or never existed — so a post id is not a way to learn what
 * moderation did or who blocked whom.
 *
 * `$1` is always the viewer, in every query in this module.
 */

export const PAGE = 20

/** A post `p`, written by member `m`, as viewer `$1` may see it. */
export const VISIBLE_POST = `p.state = 'visible' AND ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'p.author_id')}`

/**
 * The only place member columns are selected for Threads.
 *
 * Constitution 2.0.0 removed response schemas, so nothing structural stops a
 * `members` column reaching a client any more; a post response joins up to
 * four members (author, reposter, quoted author, mentions). Selecting them
 * through this one fragment is what keeps email, mobile and birthday out of
 * every one of them (tests/ops/no-pii-in-social.test.ts).
 */
export const AUTHOR_COLUMNS = (alias: string, prefix: string) => `
  ${alias}.id AS ${prefix}id, ${alias}.display_name AS ${prefix}name, ${alias}.handle AS ${prefix}handle,
  (SELECT av.asset_id FROM member_avatars av WHERE av.member_id = ${alias}.id) AS ${prefix}avatar_id,
  EXISTS (SELECT 1 FROM member_designations d
           WHERE d.member_id = ${alias}.id AND d.designation = 'influencer' AND d.revoked_at IS NULL) AS ${prefix}influencer`

/**
 * The columns of a post as a member sees it, with counts computed live and
 * the viewer's own like/repost. Counts of replies and quotes count only what
 * the viewer could open, so a number never promises a post that 404s.
 */
export const POST_COLUMNS = `
  p.id, p.body, p.reply_to_id, p.root_id, p.quote_of_id, p.created_at, p.author_id,
  ${AUTHOR_COLUMNS('m', 'a_')},
  (SELECT count(*)::int FROM thread_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT count(*)::int FROM thread_posts c JOIN members cm ON cm.id = c.author_id
    WHERE c.reply_to_id = p.id AND c.state = 'visible' AND ${visibleMemberAs('cm')}) AS reply_count,
  (SELECT count(*)::int FROM thread_reposts r WHERE r.post_id = p.id) AS repost_count,
  (SELECT count(*)::int FROM thread_posts q JOIN members qm ON qm.id = q.author_id
    WHERE q.quote_of_id = p.id AND q.state = 'visible' AND ${visibleMemberAs('qm')}) AS quote_count,
  EXISTS (SELECT 1 FROM thread_likes l WHERE l.post_id = p.id AND l.member_id = $1) AS liked_by_me,
  EXISTS (SELECT 1 FROM thread_reposts r WHERE r.post_id = p.id AND r.member_id = $1) AS reposted_by_me`

export type Row = Record<string, any>
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

const iso = (value: unknown) => new Date(value as string).toISOString()

export function toAuthor(row: Row, prefix: string, media: Map<string, MediaItem>): ThreadAuthor {
  const avatarId = row[`${prefix}avatar_id`]
  return {
    id: String(row[`${prefix}id`]),
    displayName: row[`${prefix}name`] ?? null,
    handle: row[`${prefix}handle`] ?? null,
    avatar: avatarId ? media.get(String(avatarId)) ?? null : null,
    isInfluencer: Boolean(row[`${prefix}influencer`]),
  }
}

/**
 * Posts rows → wire posts, with everything that lives in another table loaded
 * in one batch per table rather than per post: media, mentions, avatars, and
 * the quoted posts.
 *
 * Quoted posts are loaded through `VISIBLE_POST` for the same viewer. One
 * that does not come back is a tombstone, `{ unavailable: true }`, carrying
 * nothing of it — not its body, author or media (research R6, SC-005).
 */
export async function hydratePosts(db: Queryable, rows: Row[], viewerId: string): Promise<ThreadPost[]> {
  if (rows.length === 0) return []

  const quoteIds = [...new Set(rows.map((r) => r.quote_of_id).filter(Boolean).map(String))]
  const quoted = new Map<string, ThreadPostSummary>()
  if (quoteIds.length > 0) {
    const { rows: quotedRows } = await db.query(
      `SELECT ${POST_COLUMNS}
         FROM thread_posts p JOIN members m ON m.id = p.author_id
        WHERE p.id = ANY($2::uuid[]) AND ${VISIBLE_POST}`,
      [viewerId, quoteIds],
    )
    for (const post of await summarise(db, quotedRows, viewerId)) quoted.set(post.id, post)
  }

  const summaries = await summarise(db, rows, viewerId)
  return summaries.map((summary, i) => {
    const row = rows[i]!
    const { quoteOfId, ...fields } = summary
    const quotedPost = quoteOfId ? quoted.get(quoteOfId) : undefined
    return {
      ...fields,
      quoted: quoteOfId ? (quotedPost ? { unavailable: false as const, post: quotedPost } : { unavailable: true as const }) : null,
      likedByMe: Boolean(row.liked_by_me),
      repostedByMe: Boolean(row.reposted_by_me),
    }
  })
}

/** The shape shared by a post and a quoted post, without viewer state. */
export async function summarise(db: Queryable, rows: Row[], viewerId: string): Promise<ThreadPostSummary[]> {
  if (rows.length === 0) return []
  const postIds = rows.map((r) => String(r.id))

  const { rows: mediaRows } = await db.query(
    `SELECT post_id, asset_id FROM thread_post_media WHERE post_id = ANY($1::uuid[]) ORDER BY post_id, position`,
    [postIds],
  )
  // Mentions of somebody the viewer cannot see render as plain text: linking
  // them would be a way to learn that the account exists.
  const { rows: mentionRows } = await db.query(
    `SELECT mn.post_id, mn.member_id, mn.handle_as_written
       FROM thread_post_mentions mn JOIN members m ON m.id = mn.member_id
      WHERE mn.post_id = ANY($2::uuid[]) AND ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'mn.member_id')}`,
    [viewerId, postIds],
  )

  const assetIds = [
    ...mediaRows.map((r) => String(r.asset_id)),
    ...rows.map((r) => r.a_avatar_id).filter(Boolean).map(String),
  ]
  const media = await loadMediaItems(db, assetIds)

  const mediaByPost = new Map<string, MediaItem[]>()
  for (const r of mediaRows) {
    const item = media.get(String(r.asset_id))
    if (!item) continue
    const list = mediaByPost.get(String(r.post_id)) ?? []
    list.push(item)
    mediaByPost.set(String(r.post_id), list)
  }
  const mentionsByPost = new Map<string, { memberId: string; handle: string }[]>()
  for (const r of mentionRows) {
    const list = mentionsByPost.get(String(r.post_id)) ?? []
    list.push({ memberId: String(r.member_id), handle: String(r.handle_as_written) })
    mentionsByPost.set(String(r.post_id), list)
  }

  return rows.map((row) => ({
    id: String(row.id),
    author: toAuthor(row, 'a_', media),
    body: String(row.body),
    replyToId: row.reply_to_id ? String(row.reply_to_id) : null,
    rootId: row.root_id ? String(row.root_id) : null,
    quoteOfId: row.quote_of_id ? String(row.quote_of_id) : null,
    createdAt: iso(row.created_at),
    media: mediaByPost.get(String(row.id)) ?? [],
    mentions: mentionsByPost.get(String(row.id)) ?? [],
    likeCount: row.like_count,
    replyCount: row.reply_count,
    repostCount: row.repost_count,
    quoteCount: row.quote_count,
    isMine: String(row.author_id) === viewerId,
  }))
}

/** Author rows (selected with `AUTHOR_COLUMNS(…, prefix)`) → wire authors. */
export async function hydrateAuthors(db: Queryable, rows: Row[], prefix: string): Promise<ThreadAuthor[]> {
  const media = await loadMediaItems(db, rows.map((r) => r[`${prefix}avatar_id`]).filter(Boolean).map(String))
  return rows.map((row) => toAuthor(row, prefix, media))
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

/** Mutes are curation, not visibility: they narrow feeds and nothing else. */
const NOT_MUTED = (authorColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM member_mutes mu WHERE mu.muter_id = $1 AND mu.muted_id = ${authorColumn})`

type FeedCursor = { a: string; p: string; r: string }
export const isFeedCursor = (v: any) => typeof v?.a === 'string' && typeof v?.p === 'string' && typeof v?.r === 'string'

/**
 * The feed: posts and reposts as *entries*, newest activity first.
 *
 * `following` is your own posts, the posts of people you follow, and what they
 * reposted — at the moment they reposted it, which is what puts an old post
 * back at the top of the feed. `all` ("For you") is every top-level post,
 * originals only, newest first: without a follow graph to scope them, reposts
 * would only be duplicates, and no ranking is applied (spec A-5).
 *
 * Both exclude authors (and reposters) the viewer muted.
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
            e.activity_at, e.reposter_id, ${AUTHOR_COLUMNS('rm', 'r_')}
       FROM entries e
       JOIN thread_posts p ON p.id = e.post_id
       JOIN members m ON m.id = p.author_id
       LEFT JOIN members rm ON rm.id = e.reposter_id
      WHERE ${VISIBLE_POST}
        AND ${NOT_MUTED('p.author_id')}
        AND (e.reposter_id IS NULL OR (${visibleMemberAs('rm')} AND ${NOT_MUTED('e.reposter_id')}
                                       AND ${notBlockedBetween('$1', 'e.reposter_id')}))
        ${keyset}
      ORDER BY e.activity_at DESC, p.id DESC, COALESCE(e.reposter_id::text, '') DESC
      LIMIT $2`,
    params,
    { signal },
  )

  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  const posts = await hydratePosts(app.pg, page, viewerId)
  const reposters = await hydrateAuthors(app.pg, page.filter((r) => r.reposter_id), 'r_')
  const reposterById = new Map(reposters.map((a) => [a.id, a]))
  return {
    items: page.map((row, i) => ({
      post: posts[i]!,
      repostedBy: row.reposter_id ? reposterById.get(String(row.reposter_id)) ?? null : null,
      activityAt: iso(row.activity_at),
    })),
    nextCursor: rows.length > PAGE && last
      ? encode({ a: iso(last.activity_at), p: String(last.id), r: last.reposter_id ? String(last.reposter_id) : '' })
      : null,
  }
}

type PostCursor = { c: string; p: string }
export const isPostCursor = (v: any) => typeof v?.c === 'string' && typeof v?.p === 'string'

/**
 * A member's posts, newest first — one of their profile's four tabs.
 *
 * `threads` (the default, and 009's behaviour) is their top-level posts;
 * `replies` their answers; `media` their posts carrying media; `reposts` what
 * they reposted, ordered by when they reposted it. The author must be visible
 * to the viewer at all, or every tab is the same 404 as their profile.
 */
export async function loadMemberPosts(
  app: GwcApp,
  { viewerId, authorId, tab = 'threads', cursor, signal }:
    { viewerId: string; authorId: string; tab?: ProfileTab; cursor: PostCursor | null; signal?: AbortSignal },
) {
  const { rows: author } = await query(
    app.pg,
    `SELECT 1 FROM members m WHERE m.id = $2 AND ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'm.id')}`,
    [viewerId, authorId],
    { signal },
  )
  if (author.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')

  const params: unknown[] = [viewerId, authorId, PAGE + 1]
  if (tab === 'reposts') {
    let keyset = ''
    if (cursor) {
      params.push(cursor.c, cursor.p)
      keyset = 'AND (r.created_at, p.id) < ($4::timestamptz, $5::uuid)'
    }
    const { rows } = await query(
      app.pg,
      `SELECT ${POST_COLUMNS}, r.created_at AS sort_at
         FROM thread_reposts r
         JOIN thread_posts p ON p.id = r.post_id
         JOIN members m ON m.id = p.author_id
        WHERE r.member_id = $2 AND ${VISIBLE_POST} ${keyset}
        ORDER BY r.created_at DESC, p.id DESC
        LIMIT $3`,
      params,
      { signal },
    )
    return paginatePosts(app, rows, viewerId, 'desc')
  }

  // Unknown tabs read as `threads` rather than reaching SQL as `undefined`:
  // the enum on the route goes with 007 Phase 6, and this must not become a
  // 500 when it does (007 data-model §4f, rule 51).
  const filters: Record<string, string> = {
    threads: 'p.reply_to_id IS NULL',
    replies: 'p.reply_to_id IS NOT NULL',
    media: 'EXISTS (SELECT 1 FROM thread_post_media pm WHERE pm.post_id = p.id)',
  }
  const filter = filters[tab] ?? filters.threads!
  let keyset = ''
  if (cursor) {
    params.push(cursor.c, cursor.p)
    keyset = 'AND (p.created_at, p.id) < ($4::timestamptz, $5::uuid)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT ${POST_COLUMNS}, p.created_at AS sort_at
       FROM thread_posts p
       JOIN members m ON m.id = p.author_id
      WHERE p.author_id = $2 AND ${filter} AND ${VISIBLE_POST} ${keyset}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $3`,
    params,
    { signal },
  )
  return paginatePosts(app, rows, viewerId, 'desc')
}

async function paginatePosts(app: GwcApp, rows: Row[], viewerId: string, _order: 'asc' | 'desc') {
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    items: await hydratePosts(app.pg, page, viewerId),
    nextCursor: rows.length > PAGE && last
      ? encode({ c: iso(last.sort_at ?? last.created_at), p: String(last.id) })
      : null,
  }
}

export async function loadVisiblePostRow(db: Queryable, viewerId: string, postId: string) {
  const { rows } = await db.query(
    `SELECT ${POST_COLUMNS}
       FROM thread_posts p
       JOIN members m ON m.id = p.author_id
      WHERE p.id = $2 AND ${VISIBLE_POST}`,
    [viewerId, postId],
  )
  return rows[0] ?? null
}

export async function loadVisiblePost(db: Queryable, viewerId: string, postId: string): Promise<ThreadPost | null> {
  const row = await loadVisiblePostRow(db, viewerId, postId)
  return row ? (await hydratePosts(db, [row], viewerId))[0]! : null
}

export const notFound = () => refuse(PROBLEMS.NOT_FOUND, 'No such post.')

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
  const row = await loadVisiblePostRow(app.pg, viewerId, postId)
  if (!row) throw notFound()

  // The parent may have been moderated since; the reply still stands, but
  // shows what it answered only while that is itself visible.
  const parent = row.reply_to_id ? await loadVisiblePost(app.pg, viewerId, String(row.reply_to_id)) : null

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
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    post: (await hydratePosts(app.pg, [row], viewerId))[0]!,
    parent,
    replies: await hydratePosts(app.pg, page, viewerId),
    nextCursor: rows.length > PAGE && last ? encode({ c: iso(last.created_at), p: String(last.id) }) : null,
  }
}

/** The visible quotes of a post, newest first. The post itself must be visible. */
export async function listQuotes(
  app: GwcApp,
  { viewerId, postId, cursor, signal }:
    { viewerId: string; postId: string; cursor: PostCursor | null; signal?: AbortSignal },
) {
  if (!(await loadVisiblePostRow(app.pg, viewerId, postId))) throw notFound()
  const params: unknown[] = [viewerId, postId, PAGE + 1]
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
      WHERE p.quote_of_id = $2 AND ${VISIBLE_POST} ${keyset}
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT $3`,
    params,
    { signal },
  )
  return paginatePosts(app, rows, viewerId, 'desc')
}

type AuthorCursor = { c: string; m: string }
export const isAuthorCursor = (v: any) => typeof v?.c === 'string' && typeof v?.m === 'string'

/**
 * A page of members from a relation (likers, followers, following), newest
 * relation first. `relation` yields `(member_id, created_at)` rows and may use
 * `$2` for its subject; only members the viewer can see are listed.
 */
async function listAuthors(
  app: GwcApp,
  { viewerId, subjectId, relation, cursor, signal }:
    { viewerId: string; subjectId: string; relation: string; cursor: AuthorCursor | null; signal?: AbortSignal },
) {
  const params: unknown[] = [viewerId, subjectId, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.c, cursor.m)
    keyset = 'AND (x.created_at, m.id) < ($4::timestamptz, $5::uuid)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT ${AUTHOR_COLUMNS('m', 'u_')}, x.created_at
       FROM (${relation}) x
       JOIN members m ON m.id = x.member_id
      WHERE ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'm.id')} ${keyset}
      ORDER BY x.created_at DESC, m.id DESC
      LIMIT $3`,
    params,
    { signal },
  )
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]
  return {
    items: await hydrateAuthors(app.pg, page, 'u_'),
    nextCursor: rows.length > PAGE && last ? encode({ c: iso(last.created_at), m: String(last.u_id) }) : null,
  }
}

export async function listLikers(
  app: GwcApp,
  { viewerId, postId, cursor, signal }:
    { viewerId: string; postId: string; cursor: AuthorCursor | null; signal?: AbortSignal },
) {
  if (!(await loadVisiblePostRow(app.pg, viewerId, postId))) throw notFound()
  return listAuthors(app, {
    viewerId, subjectId: postId, cursor, signal,
    relation: 'SELECT member_id, created_at FROM thread_likes WHERE post_id = $2',
  })
}

/** Whether `memberId` is somebody `viewerId` may see — the profile's own 404 rule. */
export async function assertVisibleMember(db: Queryable, viewerId: string, memberId: string) {
  const { rows } = await db.query(
    `SELECT 1 FROM members m WHERE m.id = $2 AND ${visibleMemberAs('m')} AND ${notBlockedBetween('$1', 'm.id')}`,
    [viewerId, memberId],
  )
  if (rows.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
}

export async function listFollowers(
  app: GwcApp,
  { viewerId, memberId, cursor, signal }:
    { viewerId: string; memberId: string; cursor: AuthorCursor | null; signal?: AbortSignal },
) {
  await assertVisibleMember(app.pg, viewerId, memberId)
  return listAuthors(app, {
    viewerId, subjectId: memberId, cursor, signal,
    relation: 'SELECT follower_id AS member_id, created_at FROM member_follows WHERE followee_id = $2',
  })
}

export async function listFollowing(
  app: GwcApp,
  { viewerId, memberId, cursor, signal }:
    { viewerId: string; memberId: string; cursor: AuthorCursor | null; signal?: AbortSignal },
) {
  await assertVisibleMember(app.pg, viewerId, memberId)
  return listAuthors(app, {
    viewerId, subjectId: memberId, cursor, signal,
    relation: 'SELECT followee_id AS member_id, created_at FROM member_follows WHERE follower_id = $2',
  })
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
 *
 * A post the viewer cannot see — including across a block — answers 404 both
 * ways, so neither side can like or repost the other's posts.
 */
export async function setReaction(
  app: GwcApp,
  { memberId, postId, kind, on, signal }:
    { memberId: string; postId: string; kind: 'like' | 'repost'; on: boolean; signal?: AbortSignal },
) {
  if (!(await loadVisiblePostRow(app.pg, memberId, postId))) throw notFound()
  const table = kind === 'like' ? 'thread_likes' : 'thread_reposts'
  await query(
    app.pg,
    on
      ? `INSERT INTO ${table} (post_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`
      : `DELETE FROM ${table} WHERE post_id = $1 AND member_id = $2`,
    [postId, memberId],
    { signal },
  )
  return (await loadVisiblePost(app.pg, memberId, postId))!
}

export async function reportPost(
  app: GwcApp,
  { memberId, postId, reason, requestId, signal }:
    { memberId: string; postId: string; reason: string; requestId?: string; signal?: AbortSignal },
) {
  if (!(await loadVisiblePostRow(app.pg, memberId, postId))) throw notFound()
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
 * profile, so the follow endpoint is not a second way to probe accounts, and
 * a block (either way) makes following impossible rather than pointless.
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
    await assertVisibleMember(client, followerId, followeeId)
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
