import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { visibleMemberAs } from '../../profile/application/profile.ts'
import { AUTHOR_COLUMNS, hydrateAuthors } from './threads.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Blocks and mutes (feature 010, US8, research R10).
 *
 * A block is visibility: mutual, enforced wherever Threads reads a post or a
 * member (the predicate in threads.ts), and it ends any follow in either
 * direction in the same transaction — a follow across a block would keep
 * feeding one side the other's reposts. A mute is curation: the muter's feeds
 * only, nothing else changes, and the muted member is told nothing.
 */

type Relation = 'block' | 'mute'

const TABLE = {
  block: { table: 'member_blocks', actor: 'blocker_id', target: 'blocked_id' },
  mute: { table: 'member_mutes', actor: 'muter_id', target: 'muted_id' },
} as const

export async function setRelation(
  app: GwcApp,
  { memberId, targetId, relation, on, signal }:
    { memberId: string; targetId: string; relation: Relation; on: boolean; signal?: AbortSignal },
) {
  if (memberId === targetId) throw refuse(PROBLEMS.VALIDATION_FAILED, `You cannot ${relation} yourself.`)
  const t = TABLE[relation]
  return withTransaction(app.pg, async (client) => {
    // Only a member who exists and is visible at all. Deliberately NOT the
    // block-aware check: you must be able to block somebody who blocked you
    // first, and to undo your own block.
    const { rows } = await client.query(`SELECT 1 FROM members m WHERE m.id = $1 AND ${visibleMemberAs('m')}`, [targetId])
    if (rows.length === 0 && on) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')

    if (on) {
      await client.query(
        `INSERT INTO ${t.table} (${t.actor}, ${t.target}) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [memberId, targetId],
      )
      if (relation === 'block') {
        await client.query(
          `DELETE FROM member_follows
            WHERE (follower_id = $1 AND followee_id = $2) OR (follower_id = $2 AND followee_id = $1)`,
          [memberId, targetId],
        )
      }
    } else {
      // Unblocking restores visibility, not the follows it ended: following
      // again is the other member's choice as much as yours.
      await client.query(`DELETE FROM ${t.table} WHERE ${t.actor} = $1 AND ${t.target} = $2`, [memberId, targetId])
    }
    return relation === 'block' ? { blocked: on } : { muted: on }
  }, { signal })
}

/** Your own block or mute list, newest first — for the privacy settings screen. */
export async function listRelation(
  app: GwcApp,
  { memberId, relation, signal }: { memberId: string; relation: Relation; signal?: AbortSignal },
) {
  const t = TABLE[relation]
  const { rows } = await query(
    app.pg,
    `SELECT ${AUTHOR_COLUMNS('m', 'u_')}
       FROM ${t.table} x JOIN members m ON m.id = x.${t.target}
      WHERE x.${t.actor} = $1
      ORDER BY x.created_at DESC
      LIMIT 500`,
    [memberId],
    { signal },
  )
  return { items: await hydrateAuthors(app.pg, rows, 'u_'), nextCursor: null }
}
