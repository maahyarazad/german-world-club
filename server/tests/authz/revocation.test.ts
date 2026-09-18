import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createAdmin, grant, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { SNAPSHOT_TTL_MS } from '../../src/authz/permissions.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * SC-003 — a revoked permission is refused on the target's **very next**
 * request: no re-login, no waiting for a token to expire, no waiting out a
 * cache.
 *
 * This is the criterion that forced the whole design. If permissions were token
 * claims, the best achievable answer would be "within ten minutes"; if the
 * snapshot cache had only a TTL, it would be "within thirty seconds". Explicit
 * invalidation is what makes it "next request", and the TTL is only a backstop
 * for a write another instance made.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('revocation takes effect immediately (SC-003)', () => {
  let admin: Record<string, unknown>
  let headers: Record<string, string>

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    admin = await createAdmin(app.pg, { grants: { seo: { read: true, edit: true }, partners: { read: true, edit: true } } })
    app.permissions.invalidateAll()
    headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
  })

  const readSeo = (recordId = '00000000-0000-4000-8000-000000000000') =>
    app.inject({ method: 'GET', url: `/admin/seo/partner/${recordId}`, headers })

  it('admits the holder while the grant stands', async () => {
    const response = await readSeo()
    // 404 means the permission check passed and the record simply is not there.
    expect(response.statusCode).toBe(404)
  })

  it('REFUSES ON THE NEXT REQUEST once the grant is revoked', async () => {
    expect((await readSeo()).statusCode).toBe(404)

    await app.pg.query(
      'UPDATE admin_permissions SET can_read = false WHERE admin_user_id = $1 AND module = $2',
      [admin.id, 'seo'],
    )
    app.permissions.invalidate(admin.id)

    const after = await readSeo()
    expect(after.statusCode).toBe(403)
    expect(after.json().type).toMatch(/insufficient-permission/)
  })

  it('refuses on the next request when the whole row is deleted — absence is denial', async () => {
    expect((await readSeo()).statusCode).toBe(404)
    await app.pg.query('DELETE FROM admin_permissions WHERE admin_user_id = $1 AND module = $2', [admin.id, 'seo'])
    app.permissions.invalidate(admin.id)
    expect((await readSeo()).statusCode).toBe(403)
  })

  it('refuses on the next request when the account is deactivated', async () => {
    expect((await readSeo()).statusCode).toBe(404)
    await app.pg.query('UPDATE admin_users SET is_active = false WHERE id = $1', [admin.id])
    app.permissions.invalidate(admin.id)
    const after = await readSeo()
    expect(after.statusCode).toBe(403)
    expect(after.json().type).toMatch(/account-inactive/)
  })

  it('needs no re-login and no new token', async () => {
    const before = headers.authorization
    await app.pg.query('DELETE FROM admin_permissions WHERE admin_user_id = $1', [admin.id])
    app.permissions.invalidate(admin.id)
    expect((await readSeo()).statusCode).toBe(403)
    // The same token that worked a moment ago is still the one being presented.
    expect(headers.authorization).toBe(before)
  })

  it('grants take effect on the next request too', async () => {
    await app.pg.query('DELETE FROM admin_permissions WHERE admin_user_id = $1', [admin.id])
    app.permissions.invalidate(admin.id)
    expect((await readSeo()).statusCode).toBe(403)

    await grant(app.pg, admin.id, 'seo', { read: true })
    await grant(app.pg, admin.id, 'partners', { read: true })
    app.permissions.invalidate(admin.id)
    expect((await readSeo()).statusCode).toBe(404)
  })

  it('caches between invalidations, so this is not a query per request', async () => {
    await readSeo()
    expect(app.permissions.size()).toBeGreaterThan(0)
  })

  it('keeps the TTL as a backstop, not as the mechanism', () => {
    // If the TTL were the mechanism, SC-003 would be a 30-second promise.
    expect(SNAPSHOT_TTL_MS).toBe(30_000)
  })

  it('writes an audit record naming the permission that was required (FR-015)', async () => {
    await app.pg.query('DELETE FROM admin_permissions WHERE admin_user_id = $1', [admin.id])
    app.permissions.invalidate(admin.id)
    await readSeo()

    const { rows } = await app.pg.query(
      "SELECT actor_id, required_permission, outcome FROM audit_log WHERE action = 'permission_denied' ORDER BY id DESC LIMIT 1",
    )
    expect(rows[0]).toMatchObject({ actor_id: admin.id, required_permission: 'seo.read', outcome: 'denied' })
  })

  it('bypasses the matrix entirely for a superadmin (FR-008)', async () => {
    const superadmin = await createAdmin(app.pg, { isSuperadmin: true })
    app.permissions.invalidateAll()
    const superHeaders = await bearerFor(app, { accountId: superadmin.id, accountKind: 'admin' })
    const response = await app.inject({
      method: 'GET', url: '/admin/seo/partner/00000000-0000-4000-8000-000000000000', headers: superHeaders,
    })
    expect(response.statusCode).toBe(404)
  })
})
