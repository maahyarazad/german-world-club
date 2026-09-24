import { query } from '../../../db/query.ts'
import { visibleMemberAs, notBlockedBetween } from '../../profile/application/profile.ts'
import {
  AUTHOR_COLUMNS, POST_COLUMNS, VISIBLE_POST, PAGE, decodeCursor, hydrateAuthors, summarise,
} from './threads.ts'
import type { GwcApp } from '../../../app.ts'
import type { ActivityItem, ActivityPage } from '@gwc/contracts/threads'

/**
 * Activity (feature 010, US5, research R8): what happened to you — likes,
 * replies, quotes and reposts of your posts, mentions of you, and follows.
 *
 * Computed on read from the facts themselves, never stored. A stored inbox
 * would need every unlike, unfollow, hide, lock and block to find and delete
 * its entries; computed, an unlike simply stops being a like. Only where the
 * member stopped reading is stored (`member_activity_cursor`).
 *
 * Visibility is the Threads rule, unchanged: an actor you cannot see (locked,
 * or a block either way) and a post you cannot open (hidden, deleted) produce
 * no item. Your own actions produce none either.
 */

/** Every event concerning viewer `$1`, as (kind, at, actor, post). */
const EVENTS = `
  SELECT 'like'::text AS kind, l.created_at AS at, l.member_id AS actor_id, l.post_id
    FROM thread_likes l JOIN thread_posts mine ON mine.id = l.post_id
   WHERE mine.author_id = $1 AND l.member_id <> $1
  UNION ALL
  SELECT 'reply', c.created_at, c.author_id, c.id
    FROM thread_posts c JOIN thread_posts mine ON mine.id = c.reply_to_id
   WHERE mine.author_id = $1 AND c.author_id <> $1
  UNION ALL
  SELECT 'quote', q.created_at, q.author_id, q.id
    FROM thread_posts q JOIN thread_posts mine ON mine.id = q.quote_of_id
   WHERE mine.author_id = $1 AND q.author_id <> $1
  UNION ALL
  SELECT 'repost', r.created_at, r.member_id, r.post_id
    FROM thread_reposts r JOIN thread_posts mine ON mine.id = r.post_id
   WHERE mine.author_id = $1 AND r.member_id <> $1
  UNION ALL
  SELECT 'mention', mn.created_at, mp.author_id, mn.post_id
    FROM thread_post_mentions mn JOIN thread_posts mp ON mp.id = mn.post_id
   WHERE mn.member_id = $1 AND mp.author_id <> $1
  UNION ALL
  SELECT 'follow', f.created_at, f.follower_id, NULL::uuid
    FROM member_follows f
   WHERE f.followee_id = $1`

/**
 * The events the viewer may see. The key makes the keyset unique: two likes by
 * one member on two posts in the same instant are two rows.
 */
const VISIBLE_EVENTS = `
  SELECT e.kind, e.at, e.actor_id, e.post_id,
         e.kind || ':' || COALESCE(e.post_id::text, '') || ':' || e.actor_id::text AS k
    FROM (${EVENTS}) e
    JOIN members am ON am.id = e.actor_id
    LEFT JOIN thread_posts p ON p.id = e.post_id
    LEFT JOIN members m ON m.id = p.author_id
   WHERE ${visibleMemberAs('am')} AND ${notBlockedBetween('$1', 'e.actor_id')}
     AND (e.post_id IS NULL OR (${VISIBLE_POST}))`

type ActivityCursor = { a: string; k: string }
export const isActivityCursor = (v: any) => typeof v?.a === 'string' && typeof v?.k === 'string'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

export async function unreadCount(app: GwcApp, { viewerId, signal }: { viewerId: string; signal?: AbortSignal }) {
  const { rows } = await query(
    app.pg,
    `SELECT count(*)::int AS unread
       FROM (${VISIBLE_EVENTS}) v
      WHERE v.at > COALESCE((SELECT seen_at FROM member_activity_cursor WHERE member_id = $1), '-infinity')`,
    [viewerId],
    { signal },
  )
  return { unread: rows[0]!.unread as number }
}

export async function loadActivity(
  app: GwcApp,
  { viewerId, cursor: raw, signal }: { viewerId: string; cursor?: string; signal?: AbortSignal },
): Promise<ActivityPage> {
  const cursor = decodeCursor<ActivityCursor>(raw, isActivityCursor)
  const params: unknown[] = [viewerId, PAGE + 1]
  let keyset = ''
  if (cursor) {
    params.push(cursor.a, cursor.k)
    keyset = 'WHERE (v.at, v.k) < ($3::timestamptz, $4::text)'
  }
  const { rows } = await query(
    app.pg,
    `SELECT v.kind, v.at, v.k, v.post_id, ${AUTHOR_COLUMNS('am', 'u_')}
       FROM (${VISIBLE_EVENTS}) v
       JOIN members am ON am.id = v.actor_id
       ${keyset}
      ORDER BY v.at DESC, v.k DESC
      LIMIT $2`,
    params,
    { signal },
  )
  const page = rows.slice(0, PAGE)
  const last = page[page.length - 1]

  const actors = await hydrateAuthors(app.pg, page, 'u_')
  const postIds = [...new Set(page.map((r) => r.post_id).filter(Boolean).map(String))]
  const { rows: postRows } = postIds.length === 0
    ? { rows: [] }
    : await query(
      app.pg,
      `SELECT ${POST_COLUMNS} FROM thread_posts p JOIN members m ON m.id = p.author_id
        WHERE p.id = ANY($2::uuid[]) AND ${VISIBLE_POST}`,
      [viewerId, postIds],
      { signal },
    )
  const posts = new Map((await summarise(app.pg, postRows, viewerId)).map((p) => [p.id, p]))

  const items: ActivityItem[] = page.map((row, i) => ({
    kind: row.kind,
    at: new Date(row.at).toISOString(),
    actor: actors[i]!,
    post: row.post_id ? posts.get(String(row.post_id)) ?? null : null,
  }))
  return {
    items,
    nextCursor: rows.length > PAGE && last ? encode({ a: new Date(last.at).toISOString(), k: String(last.k) }) : null,
    unread: (await unreadCount(app, { viewerId, signal })).unread,
  }
}

/**
 * Move the unread boundary forward — never back. A client that opened
 * Activity on two devices must not make the older one resurrect what the
 * newer one already cleared, so the stored value is the greater of the two.
 * A boundary in the future is clamped to now: it would otherwise hide items
 * that have not happened yet.
 */
export async function markSeen(
  app: GwcApp,
  { viewerId, upTo, signal }: { viewerId: string; upTo: string; signal?: AbortSignal },
) {
  await query(
    app.pg,
    `INSERT INTO member_activity_cursor (member_id, seen_at) VALUES ($1, LEAST($2::timestamptz, now()))
     ON CONFLICT (member_id) DO UPDATE
       SET seen_at = GREATEST(member_activity_cursor.seen_at, EXCLUDED.seen_at)`,
    [viewerId, upTo],
    { signal },
  )
}
