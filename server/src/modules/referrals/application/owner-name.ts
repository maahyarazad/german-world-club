import type { Queryable } from './codes.ts'
import type { ReferralOwnerKind } from '@gwc/contracts/referrals'

/**
 * How a referrer is named to somebody who opened their link (FR-005, R8).
 *
 *   - a member by their display name — they chose to send the link;
 *   - a merchant or partner user by their organisation's PROFILE name.
 *     `organisation_profiles` is the only public projection of an organisation;
 *     `organisations` holds contract data and nothing here reads it beyond the
 *     join key;
 *   - staff as the club itself (`team: true`), never by a person's name: an
 *     employee's name on a recruiting page is not something staff opted into
 *     by having a console account.
 *
 * Never an email, a mobile number or anything else that would identify the
 * person beyond what they already put on the platform.
 */
export type OwnerName = { name: string | null; team: boolean }

export async function ownerDisplayName(db: Queryable, kind: ReferralOwnerKind, id: string): Promise<OwnerName> {
  if (kind === 'admin') return { name: null, team: true }
  if (kind === 'member') {
    const { rows } = await db.query('SELECT display_name FROM members WHERE id = $1', [id])
    return { name: nonEmpty(rows[0]?.display_name), team: false }
  }
  const { rows } = await db.query(
    `SELECT p.display_name
       FROM organisation_users u
       LEFT JOIN organisation_profiles p ON p.organisation_id = u.organisation_id
      WHERE u.id = $1`,
    [id],
  )
  return { name: nonEmpty(rows[0]?.display_name), team: false }
}

const nonEmpty = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
