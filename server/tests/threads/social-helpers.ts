import { randomUUID } from 'node:crypto'
import { buildMediaApp, resetMedia, multipartBody, photograph } from '../helpers/media.ts'
import { createMember, createAdmin, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Fixtures for the feature 010 suites (threads and profiles, completed).
 *
 * The app is the real one with in-memory storage and the inline media queue,
 * so uploads really go through the pipeline and attach as real `ready` assets.
 */

export type Principal = { id: string; headers: Record<string, string> }
export type Member = Principal & { handle: string | null; email: string }

export const ABSENT = '00000000-0000-0000-0000-000000000000'

export async function buildSocialApp() {
  return buildMediaApp()
}

/** Clear everything these suites write. Link tables before assets, assets before members. */
export async function resetSocial(app: GwcApp) {
  await resetAuthTables(app.pg)
  await resetMedia(app.pg)
}

let seq = 0

/** A signed-in member, with a handle unless `handle: null` is asked for. */
export async function member(
  app: GwcApp,
  name: string,
  { handle, ...rest }: { handle?: string | null; mobile?: string | null; status?: string } = {},
): Promise<Member> {
  seq += 1
  const chosen = handle === undefined ? `${name.toLowerCase()}_${seq}_${Math.random().toString(36).slice(2, 6)}` : handle
  const row = await createMember(app.pg, { displayName: name, handle: chosen, ...rest })
  return {
    id: String(row.id),
    email: String(row.email),
    handle: chosen,
    headers: await bearerFor(app, { accountId: String(row.id), accountKind: 'member' }),
  }
}

/** A signed-in organisation principal. The first user of each org is its owner. */
export async function organisationUser(
  app: GwcApp,
  kind: 'merchant' | 'partner',
  { role = 'owner', organisationId, status = 'active' }:
    { role?: 'owner' | 'manager' | 'staff'; organisationId?: string; status?: string } = {},
) {
  const tag = randomUUID().slice(0, 8)
  let orgId = organisationId
  let slug: string | undefined
  if (!orgId) {
    const { rows: [org] } = await app.pg.query(
      `INSERT INTO organisations (kind, legal_name, slug, status, location_count, employee_count, fee_tier)
       VALUES ($1, $2, $3, $4::organisation_status, $5, $6, 'gold-secret-tier') RETURNING id, slug`,
      [kind, `Legal Name ${tag} GmbH`, `org-${kind}-${tag}`, status,
        kind === 'merchant' ? 1 : null, kind === 'partner' ? 10 : null],
    )
    orgId = String(org.id)
    slug = String(org.slug)
    if (role !== 'owner') {
      // An organisation nobody can administer is refused by the database.
      await app.pg.query(
        `INSERT INTO organisation_users (organisation_id, email, role, status, display_name)
         VALUES ($1, $2, 'owner', 'active', 'Owner')`,
        [orgId, `owner-${tag}@test.invalid`],
      )
    }
  }
  const { rows: [user] } = await app.pg.query(
    `INSERT INTO organisation_users (organisation_id, email, role, status, display_name)
     VALUES ($1, $2, $3, 'active', $4) RETURNING id`,
    [orgId, `${role}-${tag}@test.invalid`, role, `Org ${role}`],
  )
  if (!slug) {
    const { rows } = await app.pg.query('SELECT slug FROM organisations WHERE id = $1', [orgId])
    slug = String(rows[0].slug)
  }
  return {
    id: String(user.id),
    organisationId: orgId,
    slug,
    headers: await bearerFor(app, { accountId: String(user.id), accountKind: kind }),
  }
}

type Grants = NonNullable<NonNullable<Parameters<typeof createAdmin>[1]>['grants']>

export async function staff(app: GwcApp, grants: Grants | Record<string, true | Record<string, boolean>> = {}) {
  const admin = await createAdmin(app.pg, { isAdmin: false, grants: grants as Grants })
  return { id: String(admin.id), headers: await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' }) }
}

let pixels = 0

/**
 * Upload a photo and return its asset. Every call produces DIFFERENT bytes:
 * identical bytes dedupe to one asset owned by whoever uploaded them first,
 * which would make an ownership assertion pass or fail for the wrong reason.
 */
export async function uploadPhoto(app: GwcApp, headers: Record<string, string>, { alt = 'A photo', url = '/media' } = {}) {
  pixels += 1
  const body = multipartBody({
    file: await photograph({ width: 640 + pixels, height: 480 }), filename: 'p.jpg', fields: { alt },
  })
  const response = await app.inject({ method: 'POST', url, headers: { ...headers, ...body.headers }, payload: body.payload })
  if (response.statusCode !== 201) throw new Error(`upload failed: ${response.statusCode} ${response.body}`)
  return response.json() as { id: string; state: string }
}

export function post(app: GwcApp, who: Principal, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/threads/posts', headers: who.headers, payload })
}

export function get(app: GwcApp, who: Principal, url: string) {
  return app.inject({ method: 'GET', url, headers: who.headers })
}

/** Status and body minus the fields that differ per request by construction. */
export const canonical = (r: { statusCode: number; json: () => Record<string, unknown> }) =>
  ({ status: r.statusCode, body: { ...r.json(), instance: null, requestId: null } })
