import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { balanceOf, stageCounts, iso, PAGE_SIZE } from './read-model.ts'
import type { Queryable, Owner } from './codes.ts'
import type { ReferralOwnerKind, StaffReferralOwner, XpRate } from '@gwc/contracts/referrals'

/**
 * What staff read about referrals (US4). The lists of one owner's referrals
 * and XP are lists.ts's — the very same queries the owner's own screen runs —
 * so a staff member sees exactly the referee fields the referrer sees and no
 * more (FR-018). A staff member who needs an applicant's contact details opens
 * the application under the `members` module, under its own grant.
 */

/**
 * An owner's name as staff see it, for an owner aliased `o` with
 * (owner_kind, owner_id). Organisation users by their own display name, then
 * their organisation's public profile name; never `organisations.legal_name`,
 * which is contract data outside this module's grant.
 */
const OWNER_NAME = `
  CASE o.owner_kind
    WHEN 'member' THEN (SELECT m.display_name FROM members m WHERE m.id = o.owner_id)
    WHEN 'admin'  THEN (SELECT a.display_name FROM admin_users a WHERE a.id = o.owner_id)
    ELSE (SELECT COALESCE(u.display_name, p.display_name)
            FROM organisation_users u
            LEFT JOIN organisation_profiles p ON p.organisation_id = u.organisation_id
           WHERE u.id = o.owner_id)
  END`

/** The owner's newest link, whatever its state — staff need to see a disabled one too. */
const LATEST_LINK = `
  (SELECT jsonb_build_object('id', l.id, 'code', l.code, 'state', l.state)
     FROM referral_links l WHERE l.owner_kind = o.owner_kind AND l.owner_id = o.owner_id
    ORDER BY l.created_at DESC, l.id DESC LIMIT 1)`

async function toOwner(db: Queryable, row: Record<string, any>): Promise<StaffReferralOwner> {
  const owner: Owner = { kind: row.owner_kind as ReferralOwnerKind, id: String(row.owner_id) }
  const [xpBalance, counts] = await Promise.all([balanceOf(db, owner), stageCounts(db, owner)])
  return {
    ownerKind: owner.kind,
    ownerId: owner.id,
    name: row.name ?? null,
    link: row.link ? { id: String(row.link.id), code: String(row.link.code), state: row.link.state } : null,
    xpBalance,
    counts,
  }
}

/**
 * Everybody who has ever had a link, most referrals first. Offset-paged: a
 * staff overview ordered by a count has no stable keyset, and it is bounded
 * by the number of people who opened Refer & earn.
 */
export async function listOwners(
  db: Queryable,
  { kind, q, cursor }: { kind?: ReferralOwnerKind; q?: string; cursor?: string },
) {
  const offset = cursor ? Number(Buffer.from(cursor, 'base64url').toString('utf8')) : 0
  if (!Number.isInteger(offset) || offset < 0) throw refuse(PROBLEMS.VALIDATION_FAILED, 'The cursor is not one this server issued.')
  const { rows } = await db.query(
    `WITH owners AS (
       SELECT DISTINCT owner_kind, owner_id FROM referral_links
        WHERE ($1::account_kind IS NULL OR owner_kind = $1)),
     o AS (
       SELECT o.owner_kind, o.owner_id, ${OWNER_NAME} AS name, ${LATEST_LINK} AS link,
              (SELECT count(*) FROM referrals r WHERE r.referrer_kind = o.owner_kind AND r.referrer_id = o.owner_id) AS referral_count
         FROM owners o)
     SELECT owner_kind, owner_id, name, link FROM o
      WHERE $2::text IS NULL OR name ILIKE '%' || $2 || '%'
      ORDER BY referral_count DESC, owner_kind, owner_id
      LIMIT $3 OFFSET $4`,
    [kind ?? null, q?.trim() || null, PAGE_SIZE + 1, offset],
  )
  const page = rows.slice(0, PAGE_SIZE)
  return {
    items: await Promise.all(page.map((row) => toOwner(db, row))),
    nextCursor: rows.length > PAGE_SIZE ? Buffer.from(String(offset + PAGE_SIZE)).toString('base64url') : null,
  }
}

const OWNER_EXISTS: Record<ReferralOwnerKind, string> = {
  member: 'SELECT 1 FROM members WHERE id = $1',
  admin: 'SELECT 1 FROM admin_users WHERE id = $1',
  merchant: `SELECT 1 FROM organisation_users u JOIN organisations g ON g.id = u.organisation_id WHERE u.id = $1 AND g.kind = 'merchant'`,
  partner: `SELECT 1 FROM organisation_users u JOIN organisations g ON g.id = u.organisation_id WHERE u.id = $1 AND g.kind = 'partner'`,
}

/** One owner, or 404 when no such account exists (having no link yet is fine). */
export async function ownerDetail(db: Queryable, owner: Owner): Promise<StaffReferralOwner> {
  const { rows: exists } = await db.query(OWNER_EXISTS[owner.kind], [owner.id])
  if (exists.length === 0) throw refuse(PROBLEMS.NOT_FOUND, 'No such account.')
  const { rows } = await db.query(
    `SELECT o.owner_kind, o.owner_id, ${OWNER_NAME} AS name, ${LATEST_LINK} AS link
       FROM (SELECT $1::account_kind AS owner_kind, $2::uuid AS owner_id) o`,
    [owner.kind, owner.id],
  )
  return toOwner(db, rows[0])
}

/** The rate in force and the 50 most recent changes, newest first. */
export async function rateWithHistory(db: Queryable): Promise<{ current: XpRate; history: XpRate[] }> {
  const { rows } = await db.query(
    `SELECT r.xp, r.effective_from, r.reason, a.display_name AS set_by_name
       FROM referral_xp_rates r LEFT JOIN admin_users a ON a.id = r.set_by
      ORDER BY r.effective_from DESC, r.id DESC
      LIMIT 50`,
  )
  const history = rows.map((row): XpRate => ({
    xp: Number(row.xp), effectiveFrom: iso(row.effective_from)!, setBy: row.set_by_name ?? null, reason: String(row.reason),
  }))
  return { current: history[0]!, history }
}
