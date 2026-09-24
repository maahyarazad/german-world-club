import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, organisationUser, uploadPhoto, get, canonical } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * US3/US4: the organisation profile (FR-014, FR-015, research R11).
 *
 * Owners and managers edit the public face; a `staff`-role user is answered
 * exactly like an outsider; members see only `organisation_profiles`, never
 * the contract data on `organisations`.
 */
describe.skipIf(!hasDatabase)('organisation profiles', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetSocial(app) })

  const edit = (who: { headers: Record<string, string> }, kind: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/profile/${kind}/public`, headers: who.headers, payload })

  it.each(['merchant', 'partner'] as const)('lets a %s owner and manager edit the public face, with a logo', async (kind) => {
    const owner = await organisationUser(app, kind)
    const manager = await organisationUser(app, kind, { role: 'manager', organisationId: owner.organisationId })
    const logo = await uploadPhoto(app, owner.headers, { url: `/media/${kind}`, alt: 'Logo' })

    const first = await edit(owner, kind, { displayName: 'Café Berlin', about: 'Coffee', website: 'https://cafe.example', logoAssetId: logo.id })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ canEdit: true, publicProfile: { displayName: 'Café Berlin', logo: { assetId: logo.id } } })

    const second = await edit(manager, kind, { city: 'Dubai', about: null })
    expect(second.json().publicProfile).toMatchObject({ city: 'Dubai', about: null, website: 'https://cafe.example' })
  })

  it('answers a staff-role user exactly like a stranger (404)', async () => {
    const owner = await organisationUser(app, 'merchant')
    const staffRole = await organisationUser(app, 'merchant', { role: 'staff', organisationId: owner.organisationId })
    const response = await edit(staffRole, 'merchant', { displayName: 'Hijacked' })
    expect(response.statusCode).toBe(404)
    // They may still READ their own profile, and are told they cannot edit.
    expect((await get(app, staffRole, '/profile/merchant')).json()).toMatchObject({ canEdit: false, role: 'staff' })
  })

  // 403, not 401: the credential is valid, just not for this audience
  // (plugins/10-auth.ts) — and merchants have no Threads access at all (A-1).
  it('refuses a merchant token on partner routes and on Threads, and a member token on both', async () => {
    const owner = await organisationUser(app, 'merchant')
    const anna = await member(app, 'Anna')
    expect((await get(app, owner, '/profile/partner')).statusCode).toBe(403)
    expect((await get(app, anna, '/profile/merchant')).statusCode).toBe(403)
    expect((await get(app, owner, '/threads/feed')).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/threads/feed' })).statusCode).toBe(401)
  })

  it('shows members an active organisation\'s public face and none of its contract data', async () => {
    const owner = await organisationUser(app, 'partner')
    await edit(owner, 'partner', { displayName: 'Partner Bank', city: 'Frankfurt' })
    const anna = await member(app, 'Anna')
    const response = await get(app, anna, `/profile/organisations/${owner.slug}`)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ slug: owner.slug, kind: 'partner', displayName: 'Partner Bank' })
    expect(response.body).not.toContain('gold-secret-tier')
    expect(response.body).not.toContain('Legal Name')
  })

  it.each(['pending', 'suspended', 'ended'])('hides a %s organisation like one that never existed', async (status) => {
    const owner = await organisationUser(app, 'merchant')
    await edit(owner, 'merchant', { displayName: 'Soon gone' })
    await app.pg.query(`UPDATE organisations SET status = $2 WHERE id = $1`, [owner.organisationId, status])
    const anna = await member(app, 'Anna')
    expect(canonical(await get(app, anna, `/profile/organisations/${owner.slug}`)))
      .toEqual(canonical(await get(app, anna, '/profile/organisations/no-such-slug')))
  })

  it('refuses a logo uploaded by somebody outside the organisation', async () => {
    const owner = await organisationUser(app, 'merchant')
    const other = await organisationUser(app, 'merchant')
    const theirs = await uploadPhoto(app, other.headers, { url: '/media/merchant' })
    expect((await edit(owner, 'merchant', { logoAssetId: theirs.id })).statusCode).toBe(404)
  })
})
