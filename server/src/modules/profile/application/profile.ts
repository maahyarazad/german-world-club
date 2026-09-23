import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'
import type {
  MemberProfile, OrganisationProfile, PublicMemberProfile, UpdateProfileRequest,
} from '@gwc/contracts/profile'

/**
 * Profiles (feature 009). Every query names its columns — this is the table
 * with the password hash in it.
 */

const FOLLOW_COUNTS = `
  (SELECT count(*)::int FROM member_follows f WHERE f.followee_id = m.id) AS followers,
  (SELECT count(*)::int FROM member_follows f WHERE f.follower_id = m.id) AS following`

/**
 * Who counts as a visible member to other members: active, and not an
 * applicant still waiting (or refused). Shared with threads, so a member who
 * cannot be seen here cannot be seen there either.
 */
export const VISIBLE_MEMBER = `
  m.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM membership_applications a
                   WHERE a.member_id = m.id AND a.state <> 'approved')`

export async function loadOwnProfile(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<MemberProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT m.id, m.display_name, m.email, m.mobile, m.gender, m.country_of_residence,
            m.bio, m.city, m.created_at,
            to_char(m.birthday, 'YYYY-MM-DD') AS birthday,
            ${FOLLOW_COUNTS}
       FROM members m WHERE m.id = $1`,
    [memberId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
  return {
    kind: 'member',
    id: String(row.id),
    displayName: row.display_name ?? null,
    email: String(row.email),
    mobile: row.mobile ?? null,
    birthday: row.birthday ?? null,
    gender: row.gender ?? null,
    countryOfResidence: row.country_of_residence ?? null,
    bio: row.bio ?? null,
    city: row.city ?? null,
    memberSince: new Date(row.created_at).toISOString(),
    followers: row.followers,
    following: row.following,
  }
}

/**
 * Only the fields the request names are written: absent means untouched,
 * null means cleared. Building the SET list from the request, rather than
 * writing every column, is what keeps a stale client from blanking a field it
 * never displayed.
 */
export async function updateOwnProfile(
  app: GwcApp,
  { memberId, changes, signal }: { memberId: string; changes: UpdateProfileRequest; signal?: AbortSignal },
) {
  const columns: Record<keyof UpdateProfileRequest, string> = {
    bio: 'bio',
    city: 'city',
    gender: 'gender',
    countryOfResidence: 'country_of_residence',
  }
  const sets: string[] = []
  const values: unknown[] = [memberId]
  for (const [key, column] of Object.entries(columns) as [keyof UpdateProfileRequest, string][]) {
    if (changes[key] === undefined) continue
    // An empty string is a cleared field, not a value worth storing.
    const value = typeof changes[key] === 'string' && changes[key] === '' ? null : changes[key]
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (sets.length > 0) {
    await query(app.pg, `UPDATE members SET ${sets.join(', ')} WHERE id = $1`, values, { signal })
  }
  return loadOwnProfile(app, { memberId, signal })
}

export async function loadMemberProfile(
  app: GwcApp,
  { viewerId, memberId, signal }: { viewerId: string; memberId: string; signal?: AbortSignal },
): Promise<PublicMemberProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT m.id, m.display_name, m.bio, m.city, m.country_of_residence,
            ${FOLLOW_COUNTS},
            EXISTS (SELECT 1 FROM member_follows f WHERE f.follower_id = $2 AND f.followee_id = m.id) AS is_following
       FROM members m
      WHERE m.id = $1 AND ${VISIBLE_MEMBER}`,
    [memberId, viewerId],
    { signal },
  )
  const row = rows[0]
  // A locked member and one who never existed answer the same, so a profile
  // id is not a way to learn somebody's account state.
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
  return {
    id: String(row.id),
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    city: row.city ?? null,
    countryOfResidence: row.country_of_residence ?? null,
    followers: row.followers,
    following: row.following,
    isFollowing: row.is_following,
    isSelf: memberId === viewerId,
  }
}

/**
 * A merchant's or partner's own profile.
 *
 * Their person row and their organisation, never the organisation's contract
 * or billing — those are staff-managed and the portal has its own views.
 */
export async function loadOrganisationProfile(
  app: GwcApp,
  { principalId, kind, signal }: { principalId: string; kind: 'merchant' | 'partner'; signal?: AbortSignal },
): Promise<OrganisationProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT ou.id, ou.display_name, ou.email, ou.role,
            o.id AS organisation_id, o.legal_name, o.status AS organisation_status
       FROM organisation_users ou
       JOIN organisations o ON o.id = ou.organisation_id
      WHERE ou.id = $1`,
    [principalId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such account.')
  return {
    kind,
    id: String(row.id),
    displayName: row.display_name ?? null,
    email: String(row.email),
    role: String(row.role),
    organisation: { id: String(row.organisation_id), name: String(row.legal_name), status: String(row.organisation_status) },
  }
}
