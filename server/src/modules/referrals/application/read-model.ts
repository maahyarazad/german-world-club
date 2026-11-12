import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../../authz/require-permission.ts'
import type { Queryable, Owner } from './codes.ts'
import type { ReferralSummary, StageCounts } from '@gwc/contracts/referrals'

/**
 * What a referral looks like from the outside: its stage, its referee's name,
 * the owner's balance. All of it computed on read (research R14, FR-015).
 *
 * Nothing here is stored, and that is the design rather than a shortcut:
 *   - a stored stage would be a second copy of facts onboarding already owns,
 *     and every onboarding write would have to remember to update it;
 *   - a stored balance could be moved by a bug without a matching entry, and
 *     the number people read would be the one that was wrong.
 */

/**
 * The referee as a referrer may see them, for a referral aliased `r` joined to
 * `members m` (FR-018, R15): their handle, or "First L." — nothing else.
 *
 * This is the ONLY selection of referee fields on any referral route. It names
 * what it reads because nothing else stops a column added to `members` later
 * from reaching a referrer (Principle VI as amended): the contact details, the
 * birthday and the country sit one `m.*` away.
 */
export const REFEREE_NAME = `
  COALESCE(
    '@' || m.handle::text,
    NULLIF(
      split_part(btrim(m.display_name), ' ', 1)
        || CASE WHEN position(' ' IN btrim(m.display_name)) > 0
                THEN ' ' || left(regexp_replace(btrim(m.display_name), '^.*\\s', ''), 1) || '.'
                ELSE '' END,
      ''),
    '—')`

/**
 * The stage, for a referral aliased `r` joined to the referee's application
 * `a` and profiling `p` (R14). The denial REASON is never selected: a referrer
 * learns that somebody did not join, not why (FR-018).
 */
export const STAGE_COLUMNS = `
  CASE WHEN a.state = 'denied'            THEN 'did_not_join'
       WHEN p.completed_at IS NOT NULL    THEN 'joined'
       WHEN a.state = 'approved'          THEN 'approved'
       ELSE 'registered' END                              AS stage,
  CASE WHEN a.state = 'approved' THEN a.reviewed_at END   AS approved_at,
  CASE WHEN a.state <> 'denied' THEN p.completed_at END   AS joined_at,
  CASE WHEN a.state = 'denied'   THEN a.reviewed_at END   AS ended_at`

export const STAGE_JOINS = `
  JOIN members m                       ON m.id = r.referee_member_id
  LEFT JOIN membership_applications a  ON a.member_id = r.referee_member_id
  LEFT JOIN member_profiling p         ON p.member_id = r.referee_member_id`

/** The owner's XP: the sum of their history, never a stored figure (FR-015). */
export async function balanceOf(db: Queryable, owner: Owner): Promise<number> {
  const { rows } = await db.query(
    'SELECT COALESCE(SUM(amount), 0)::int AS balance FROM xp_entries WHERE owner_kind = $1 AND owner_id = $2',
    [owner.kind, owner.id],
  )
  return Number(rows[0]?.balance ?? 0)
}

export async function stageCounts(db: Queryable, owner: Owner): Promise<StageCounts> {
  const { rows } = await db.query(
    `SELECT stage, count(*)::int AS n FROM (
       SELECT ${STAGE_COLUMNS}
         FROM referrals r ${STAGE_JOINS}
        WHERE r.referrer_kind = $1 AND r.referrer_id = $2) s
      GROUP BY stage`,
    [owner.kind, owner.id],
  )
  const counts: StageCounts = { registered: 0, approved: 0, joined: 0, did_not_join: 0 }
  for (const row of rows) counts[row.stage as keyof StageCounts] = Number(row.n)
  return counts
}

export function linkUrl(canonicalOrigin: string, code: string) {
  return `${canonicalOrigin.replace(/\/+$/, '')}/r/${code}`
}

export async function summaryFor(
  db: Queryable,
  canonicalOrigin: string,
  owner: Owner,
  link: { code: string; created_at: Date | string },
): Promise<ReferralSummary> {
  const [xpBalance, counts] = await Promise.all([balanceOf(db, owner), stageCounts(db, owner)])
  return {
    link: { code: link.code, url: linkUrl(canonicalOrigin, link.code), createdAt: new Date(link.created_at).toISOString() },
    xpBalance,
    counts,
  }
}

// --- Keyset cursors -------------------------------------------------------------
// Opaque to clients: (created_at, id) of the last row served, so a row inserted
// while somebody pages is neither shown twice nor skipped.

export const encodeCursor = (row: { created_at: Date | string; id: string }) =>
  Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`).toString('base64url')

export function decodeCursor(cursor: string | undefined): [Date, string] | [null, null] {
  if (!cursor) return [null, null]
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')
  const date = new Date(at ?? '')
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw forbidden(PROBLEMS.VALIDATION_FAILED, 'The cursor is not one this server issued.')
  }
  return [date, id]
}

export const PAGE_SIZE = 50

export const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null)
