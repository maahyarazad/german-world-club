import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'
import type {
  OrganisationProfile, OrganisationPublicProfile, UpdateOrganisationProfileRequest,
} from '@gwc/contracts/profile'

/**
 * Organisation profiles (feature 010, US3/US4, research R11).
 *
 * Two readers, one table. The organisation's own people see their account and
 * the public face; members see the public face only. The public face is
 * `organisation_profiles`, which carries no contract data — `legal_name`, fee
 * tier and contract dates stay on `organisations`, where no query in this file
 * can reach them from a member route.
 */

type Kind = 'merchant' | 'partner'

/** Owner and manager edit; `staff` role reads. Mirrors the portal's own split. */
const EDITING_ROLES = new Set(['owner', 'manager'])

const PUBLIC_COLUMNS = `
  o.slug, o.kind, op.display_name, op.about, op.website, op.city, op.logo_asset_id`

async function toPublic(app: GwcApp, row: Record<string, any> | undefined): Promise<OrganisationPublicProfile | null> {
  if (!row || !row.display_name) return null
  const logo = row.logo_asset_id ? (await loadMediaItems(app.pg, [String(row.logo_asset_id)])).get(String(row.logo_asset_id)) ?? null : null
  return {
    slug: String(row.slug),
    kind: row.kind,
    displayName: String(row.display_name),
    about: row.about ?? null,
    website: row.website ?? null,
    city: row.city ?? null,
    logo,
  }
}

/**
 * A merchant's or partner's own profile: their person row, their
 * organisation, and its public face. The organisation's `legal_name` is shown
 * to its OWN people — it is their contract — and never on the public face.
 */
export async function loadOwnOrganisationProfile(
  app: GwcApp,
  { principalId, kind, signal }: { principalId: string; kind: Kind; signal?: AbortSignal },
): Promise<OrganisationProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT ou.id, ou.display_name AS user_name, ou.email, ou.role,
            o.id AS organisation_id, o.legal_name, o.status AS organisation_status,
            ${PUBLIC_COLUMNS}
       FROM organisation_users ou
       JOIN organisations o ON o.id = ou.organisation_id
       LEFT JOIN organisation_profiles op ON op.organisation_id = o.id
      WHERE ou.id = $1`,
    [principalId],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such account.')
  return {
    kind,
    id: String(row.id),
    displayName: row.user_name ?? null,
    email: String(row.email),
    role: String(row.role),
    organisation: { id: String(row.organisation_id), name: String(row.legal_name), status: String(row.organisation_status) },
    publicProfile: await toPublic(app, row),
    canEdit: EDITING_ROLES.has(String(row.role)),
  }
}

/**
 * An organisation as a member sees it. Only `active` organisations with a
 * public profile exist here; pending, suspended and ended ones answer like a
 * slug that never existed (Principle III: nothing is advertised that the
 * contract no longer supports).
 */
export async function loadOrganisationPublicProfile(
  app: GwcApp,
  { slug, signal }: { slug: string; signal?: AbortSignal },
): Promise<OrganisationPublicProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT ${PUBLIC_COLUMNS}
       FROM organisations o
       JOIN organisation_profiles op ON op.organisation_id = o.id
      WHERE o.slug = $1::citext AND o.status = 'active'`,
    [slug],
    { signal },
  )
  const profile = await toPublic(app, rows[0])
  if (!profile) throw refuse(PROBLEMS.NOT_FOUND, 'No such organisation.')
  return profile
}

const HTTPS_URL = /^https:\/\/\S+$/

/**
 * Edit the public face. The role is read from the database inside the
 * transaction — not from the token, and not from the per-request snapshot
 * alone — because "owner or manager of THIS organisation" is a rule about the
 * loaded target (Principle II).
 *
 * A `staff`-role user is answered 404, exactly like `guardOrganisationScope`:
 * the answer must not differ from an organisation they have no link to at all,
 * or the edit route becomes a way to learn who holds which role.
 */
export async function updateOrganisationPublicProfile(
  app: GwcApp,
  { principalId, kind, changes, signal }:
    { principalId: string; kind: Kind; changes: UpdateOrganisationProfileRequest; signal?: AbortSignal },
) {
  // Re-checked by hand for the day the request schema is gone (data-model §7).
  if (changes.displayName !== undefined && (changes.displayName.trim().length < 1 || changes.displayName.trim().length > 120)) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'The display name is 1–120 characters.')
  }
  if (changes.about && changes.about.length > 1000) throw refuse(PROBLEMS.VALIDATION_FAILED, 'About is at most 1000 characters.')
  if (changes.website && (!HTTPS_URL.test(changes.website) || changes.website.length > 200)) {
    throw refuse(PROBLEMS.VALIDATION_FAILED, 'The website is an https:// address of at most 200 characters.')
  }
  if (changes.city && changes.city.length > 120) throw refuse(PROBLEMS.VALIDATION_FAILED, 'City is at most 120 characters.')

  await withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `SELECT ou.role, o.id AS organisation_id, o.legal_name
         FROM organisation_users ou JOIN organisations o ON o.id = ou.organisation_id
        WHERE ou.id = $1 AND o.kind = $2
        FOR UPDATE OF o`,
      [principalId, kind],
    )
    const me = rows[0]
    if (!me || !EDITING_ROLES.has(String(me.role))) throw refuse(PROBLEMS.NOT_FOUND, 'No such organisation.')

    if (changes.logoAssetId) {
      // The logo must be an image uploaded by somebody from this organisation.
      const { rows: asset } = await client.query(
        `SELECT a.kind, a.state FROM assets a
          WHERE a.id = $1 AND a.uploader_kind = $2
            AND a.uploaded_by IN (SELECT id FROM organisation_users WHERE organisation_id = $3)`,
        [changes.logoAssetId, kind, me.organisation_id],
      )
      if (!asset[0]) throw refuse(PROBLEMS.NOT_FOUND, 'No such media.')
      if (asset[0].kind !== 'image') throw refuse(PROBLEMS.VALIDATION_FAILED, 'A logo is an image.')
      if (asset[0].state !== 'ready') throw refuse(PROBLEMS.VALIDATION_FAILED, `That upload is still ${asset[0].state}.`)
    }

    // An absent field is left alone; a present null clears it. The row is
    // created on the first edit, named after the organisation until somebody
    // gives it a public name.
    await client.query(
      `INSERT INTO organisation_profiles (organisation_id, display_name, updated_by)
       VALUES ($1, $2, $3) ON CONFLICT (organisation_id) DO NOTHING`,
      [me.organisation_id, changes.displayName?.trim() ?? String(me.legal_name).slice(0, 120), principalId],
    )
    const columns: Record<string, string> = {
      displayName: 'display_name', about: 'about', website: 'website', city: 'city', logoAssetId: 'logo_asset_id',
    }
    const sets: string[] = ['updated_at = now()', 'updated_by = $2']
    const values: unknown[] = [me.organisation_id, principalId]
    for (const [key, column] of Object.entries(columns)) {
      const value = (changes as Record<string, unknown>)[key]
      if (value === undefined) continue
      values.push(typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value)
      sets.push(`${column} = $${values.length}`)
    }
    await client.query(`UPDATE organisation_profiles SET ${sets.join(', ')} WHERE organisation_id = $1`, values)
  }, { signal })

  return loadOwnOrganisationProfile(app, { principalId, kind, signal })
}
