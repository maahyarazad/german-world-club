import { PROBLEMS } from '@gwc/contracts/errors'
import { HANDLE_CHANGE_DAYS, PROFILE_LINKS_MAX } from '@gwc/contracts/profile'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'
import type {
  MemberProfile, ProfileLink, PublicMemberProfile, UpdateProfileRequest,
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
export const visibleMemberAs = (alias: string) => `
  ${alias}.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM membership_applications a
                   WHERE a.member_id = ${alias}.id AND a.state <> 'approved')`

export const VISIBLE_MEMBER = visibleMemberAs('m')

/**
 * Neither of the two has blocked the other (feature 010). A block is mutual
 * invisibility, so both directions — and it answers exactly like absence, so
 * the blocked member cannot learn they were blocked from a status code.
 */
export const notBlockedBetween = (a: string, b: string) => `
  NOT EXISTS (SELECT 1 FROM member_blocks b
               WHERE (b.blocker_id = ${a} AND b.blocked_id = ${b})
                  OR (b.blocker_id = ${b} AND b.blocked_id = ${a}))`

export async function loadOwnProfile(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<MemberProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT m.id, m.display_name, m.email, m.mobile, m.gender, m.country_of_residence,
            m.bio, m.city, m.created_at, m.handle,
            to_char(m.birthday, 'YYYY-MM-DD') AS birthday,
            CASE WHEN m.handle IS NOT NULL AND m.handle_changed_at > now() - make_interval(days => $2)
                 THEN m.handle_changed_at + make_interval(days => $2) END AS handle_changeable_at,
            ${PROFILE_EXTRAS},
            ${FOLLOW_COUNTS}
       FROM members m WHERE m.id = $1`,
    [memberId, HANDLE_CHANGE_DAYS],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
  const extras = await loadExtras(app, row)
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
    handle: row.handle ?? null,
    handleChangeableAt: row.handle_changeable_at ? new Date(row.handle_changeable_at).toISOString() : null,
    ...extras,
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

/**
 * Another member, by id or by handle — one query, so the two routes cannot
 * disagree about who is visible (US4).
 */
export async function loadMemberProfile(
  app: GwcApp,
  { viewerId, memberId, handle, signal }:
    { viewerId: string; memberId?: string; handle?: string; signal?: AbortSignal },
): Promise<PublicMemberProfile> {
  const where = memberId ? 'm.id = $1::uuid' : 'm.handle = $1::citext'
  const { rows } = await query(
    app.pg,
    `SELECT m.id, m.display_name, m.bio, m.city, m.country_of_residence, m.handle,
            ${PROFILE_EXTRAS},
            ${FOLLOW_COUNTS},
            EXISTS (SELECT 1 FROM member_follows f WHERE f.follower_id = $2 AND f.followee_id = m.id) AS is_following,
            EXISTS (SELECT 1 FROM member_blocks b WHERE b.blocker_id = $2 AND b.blocked_id = m.id) AS is_blocked,
            EXISTS (SELECT 1 FROM member_mutes mu WHERE mu.muter_id = $2 AND mu.muted_id = m.id) AS is_muted
       FROM members m
      WHERE ${where} AND ${VISIBLE_MEMBER}
        -- Only THEIR block hides them from you. Yours does not: you must be
        -- able to open the profile of somebody you blocked in order to unblock
        -- them. What they see of you is the same 404 either way.
        AND NOT EXISTS (SELECT 1 FROM member_blocks b WHERE b.blocker_id = m.id AND b.blocked_id = $2)`,
    [memberId ?? handle, viewerId],
    { signal },
  )
  const row = rows[0]
  // A locked member, one who blocked you and one who never existed answer the
  // same, so a profile id is not a way to learn somebody's account state.
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
  const extras = await loadExtras(app, row)
  return {
    id: String(row.id),
    displayName: row.display_name ?? null,
    bio: row.bio ?? null,
    city: row.city ?? null,
    countryOfResidence: row.country_of_residence ?? null,
    followers: row.followers,
    following: row.following,
    isFollowing: row.is_following,
    isSelf: String(row.id) === viewerId,
    handle: row.handle ?? null,
    ...extras,
    isBlocked: row.is_blocked,
    isMuted: row.is_muted,
  }
}

/**
 * Set or clear the avatar (US3). Only an image the member uploaded, and only
 * once it is ready — a stranger's asset answers like an unknown one.
 */
export async function setAvatar(
  app: GwcApp,
  { memberId, assetId, signal }: { memberId: string; assetId: string | null; signal?: AbortSignal },
) {
  if (assetId === null) {
    await query(app.pg, 'DELETE FROM member_avatars WHERE member_id = $1', [memberId], { signal })
    return loadOwnProfile(app, { memberId, signal })
  }
  const { rows } = await query(
    app.pg,
    `SELECT kind, state FROM assets WHERE id = $1 AND uploaded_by = $2 AND uploader_kind = 'member'`,
    [assetId, memberId],
    { signal },
  )
  const asset = rows[0]
  if (!asset) throw refuse(PROBLEMS.NOT_FOUND, 'No such media.')
  if (asset.kind !== 'image') throw refuse(PROBLEMS.VALIDATION_FAILED, 'An avatar is a photo, not a video.')
  if (asset.state !== 'ready') {
    throw refuse(PROBLEMS.VALIDATION_FAILED, `That upload is still ${asset.state}; set it once it is ready.`)
  }
  await query(
    app.pg,
    `INSERT INTO member_avatars (member_id, asset_id) VALUES ($1, $2)
     ON CONFLICT (member_id) DO UPDATE SET asset_id = EXCLUDED.asset_id, updated_at = now()`,
    [memberId, assetId],
    { signal },
  )
  return loadOwnProfile(app, { memberId, signal })
}

const HTTPS_URL = /^https:\/\/\S+$/

/**
 * Replace the member's links, all of them, in one transaction: a failing third
 * link leaves the old set exactly as it was. Rules re-checked by hand for the
 * day the request schema is gone (data-model §7); the table has the same ones
 * as CHECKs.
 */
export async function setLinks(
  app: GwcApp,
  { memberId, links, signal }: { memberId: string; links: readonly ProfileLink[]; signal?: AbortSignal },
) {
  if (!Array.isArray(links)) throw refuse(PROBLEMS.VALIDATION_FAILED, 'Links are a list.')
  if (links.length > PROFILE_LINKS_MAX) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, `At most ${PROFILE_LINKS_MAX} links.`)
  }
  const clean = links.map((link) => ({ url: link.url.trim(), label: link.label?.trim() || null }))
  for (const link of clean) {
    if (!HTTPS_URL.test(link.url) || link.url.length > 200) {
      throw refuse(PROBLEMS.VALIDATION_FAILED, 'A link is an https:// address of at most 200 characters.')
    }
    if (link.label && link.label.length > 40) throw refuse(PROBLEMS.VALIDATION_FAILED, 'A link label is at most 40 characters.')
  }
  await withTransaction(app.pg, async (client) => {
    await client.query('DELETE FROM member_links WHERE member_id = $1', [memberId])
    for (const [position, link] of clean.entries()) {
      await client.query(
        'INSERT INTO member_links (member_id, position, url, label) VALUES ($1, $2, $3, $4)',
        [memberId, position, link.url, link.label],
      )
    }
  }, { signal })
  return loadOwnProfile(app, { memberId, signal })
}

/** Avatar id, influencer flag — selected alongside a member row `m`. */
const PROFILE_EXTRAS = `
  (SELECT av.asset_id FROM member_avatars av WHERE av.member_id = m.id) AS avatar_id,
  EXISTS (SELECT 1 FROM member_designations d
           WHERE d.member_id = m.id AND d.designation = 'influencer' AND d.revoked_at IS NULL) AS is_influencer`

async function loadExtras(app: GwcApp, row: Record<string, any>) {
  const [media, links] = await Promise.all([
    loadMediaItems(app.pg, row.avatar_id ? [String(row.avatar_id)] : []),
    query(app.pg, 'SELECT url, label FROM member_links WHERE member_id = $1 ORDER BY position', [row.id]),
  ])
  return {
    avatar: row.avatar_id ? media.get(String(row.avatar_id)) ?? null : null,
    links: links.rows.map((l) => ({ url: String(l.url), label: l.label ?? null })),
    isInfluencer: Boolean(row.is_influencer),
  }
}
