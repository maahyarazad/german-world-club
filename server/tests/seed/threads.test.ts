import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { withSeededDatabase } from './helpers.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { SeededDatabase } from './helpers.ts'

/**
 * Feature 010's demo corpus (T097/T098, research R15): what it writes, what it
 * must leave alone, and the consistent-history rule for the one fact that
 * implies history — the influencer grant.
 */
describe.skipIf(!hasDatabase)('the demo seed: threads and profiles', () => {
  let db: SeededDatabase

  beforeAll(async () => { db = await withSeededDatabase('gwc_seed_threads') }, 300_000)
  afterAll(async () => { await db?.drop() })

  const one = async (sql: string) => (await db.pool.query(sql)).rows[0]

  it('fills the tables the demo needs', async () => {
    for (const table of ['thread_posts', 'thread_post_media', 'thread_post_mentions', 'thread_likes',
      'member_follows', 'member_avatars', 'member_designations', 'organisation_profiles']) {
      expect((await one(`SELECT count(*)::int AS n FROM ${table}`)).n, table).toBeGreaterThan(0)
    }
    // Every demo member got a handle, and every one passes the format CHECK.
    expect((await one(`SELECT count(*)::int AS n FROM members WHERE email LIKE '%@%demo.invalid' AND handle IS NULL`)).n).toBe(0)
  })

  it('invents no block, mute or reading position', async () => {
    for (const table of ['member_blocks', 'member_mutes', 'member_activity_cursor']) {
      expect((await one(`SELECT count(*)::int AS n FROM ${table}`)).n, table).toBe(0)
    }
  })

  it('writes the influencer grant\'s audit entry at the grant\'s own time, with its reason', async () => {
    const row = await one(`
      SELECT d.granted_at = a.occurred_at AS same_time, a.detail->>'reason' = d.grant_reason AS same_reason
        FROM member_designations d JOIN audit_log a
          ON a.target_id = d.member_id AND a.action = 'member.designation.granted'`)
    expect(row).toEqual({ same_time: true, same_reason: true })
  })

  it('writes exactly one thread_post_created per post, at the post\'s own time, and nothing for likes or follows', async () => {
    const row = await one(`
      SELECT (SELECT count(*) FROM thread_posts)::int AS posts,
             (SELECT count(*) FROM audit_log WHERE action = 'thread_post_created')::int AS entries,
             (SELECT count(*) FROM audit_log a JOIN thread_posts p ON p.id = a.target_id
               WHERE a.action = 'thread_post_created'
                 AND (a.occurred_at <> p.created_at OR a.actor_id <> p.author_id))::int AS mismatched`)
    expect(row.entries).toBe(row.posts)
    expect(row.mismatched).toBe(0)
    expect((await one(`SELECT count(*)::int AS n FROM audit_log WHERE action NOT IN ('thread_post_created') AND action LIKE 'thread_%'`)).n).toBe(0)
  })

  it('never dates a like, reply or follow before what it depends on', async () => {
    expect((await one(`SELECT count(*)::int AS n FROM thread_likes l JOIN thread_posts p ON p.id = l.post_id WHERE l.created_at < p.created_at`)).n).toBe(0)
    expect((await one(`SELECT count(*)::int AS n FROM thread_posts r JOIN thread_posts p ON p.id = r.reply_to_id WHERE r.created_at < p.created_at`)).n).toBe(0)
    expect((await one(`SELECT count(*)::int AS n FROM member_follows f JOIN members m ON m.id IN (f.follower_id, f.followee_id) WHERE f.created_at < m.created_at`)).n).toBe(0)
  })

  it('keeps each uploader\'s quota counter equal to what they own', async () => {
    expect((await one(`
      SELECT count(*)::int AS n FROM counters c
       WHERE c.scope = 'media.stored_bytes'
         AND c.used <> (SELECT coalesce(sum(bytes), 0) FROM assets a WHERE a.uploaded_by::text = c.subject)`)).n).toBe(0)
  })
})
