import {
  REFEREE_NAME, STAGE_COLUMNS, STAGE_JOINS, PAGE_SIZE, decodeCursor, encodeCursor, iso,
} from './read-model.ts'
import type { Queryable, Owner } from './codes.ts'
import type { Referral, ReferralPage, ReferralStage, XpEntry, XpEntryPage } from '@gwc/contracts/referrals'

/**
 * A person's referrals and XP history, newest first, keyset-paged (US3).
 *
 * Every column is named. These rows join `members`, where the referee's email,
 * mobile, birthday and country live one `*` away (FR-018); `REFEREE_NAME` and
 * `STAGE_COLUMNS` are the only referee-derived values that leave.
 *
 * The same functions serve the staff console (staff-queries.ts passes any
 * owner), so a staff member sees exactly what the owner sees — no more.
 */

export async function listReferrals(db: Queryable, owner: Owner, cursor?: string): Promise<ReferralPage> {
  const [beforeAt, beforeId] = decodeCursor(cursor)
  const { rows } = await db.query(
    `SELECT r.id, r.created_at, ${REFEREE_NAME} AS referee_name, ${STAGE_COLUMNS},
            COALESCE((SELECT SUM(e.amount) FROM xp_entries e WHERE e.referral_id = r.id), 0)::int AS xp_awarded
       FROM referrals r ${STAGE_JOINS}
      WHERE r.referrer_kind = $1 AND r.referrer_id = $2
        AND ($3::timestamptz IS NULL OR (r.created_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $5`,
    [owner.kind, owner.id, beforeAt, beforeId, PAGE_SIZE + 1],
  )
  const page = rows.slice(0, PAGE_SIZE)
  return {
    items: page.map((row): Referral => ({
      id: String(row.id),
      refereeName: String(row.referee_name),
      stage: row.stage as ReferralStage,
      registeredAt: iso(row.created_at)!,
      approvedAt: iso(row.approved_at),
      joinedAt: iso(row.joined_at),
      endedAt: iso(row.ended_at),
      xpAwarded: Number(row.xp_awarded),
    })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  }
}

export async function listXp(db: Queryable, owner: Owner, cursor?: string): Promise<XpEntryPage> {
  const [beforeAt, beforeId] = decodeCursor(cursor)
  const { rows } = await db.query(
    `SELECT e.id, e.created_at, e.kind, e.amount, e.reason, e.referral_id, e.reverses_entry_id,
            ${REFEREE_NAME} AS referee_name,
            EXISTS (SELECT 1 FROM xp_entries x WHERE x.reverses_entry_id = e.id) AS reversed
       FROM xp_entries e
       JOIN referrals r ON r.id = e.referral_id
       JOIN members m   ON m.id = r.referee_member_id
      WHERE e.owner_kind = $1 AND e.owner_id = $2
        AND ($3::timestamptz IS NULL OR (e.created_at, e.id) < ($3::timestamptz, $4::uuid))
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $5`,
    [owner.kind, owner.id, beforeAt, beforeId, PAGE_SIZE + 1],
  )
  const page = rows.slice(0, PAGE_SIZE)
  return {
    items: page.map((row): XpEntry => ({
      id: String(row.id),
      kind: row.kind,
      amount: Number(row.amount),
      reason: String(row.reason),
      referralId: String(row.referral_id),
      refereeName: String(row.referee_name),
      reversesEntryId: row.reverses_entry_id ? String(row.reverses_entry_id) : null,
      reversed: row.reversed === true,
      createdAt: iso(row.created_at)!,
    })),
    nextCursor: rows.length > PAGE_SIZE ? encodeCursor(page[page.length - 1]) : null,
  }
}
