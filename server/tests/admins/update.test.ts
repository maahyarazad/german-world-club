import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, bearerFor, createAdmin, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 028, US3 — changing an administrator account.
 *
 * Each behaviour has its counter-assertion: what is allowed is shown next to
 * what is refused, so a handler that refused everything, or allowed everything,
 * fails somewhere here. `GET /admin/server-faults` stands in for "a route gated
 * on a module" because it is a real, working staff route on one module and flag.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const READ = { read: true, write: false, edit: false, delete: false, status: false }
const NONE = { read: false, write: false, edit: false, delete: false, status: false }

type Account = { id: string; version: string; role: string; isActive: boolean; grants: Record<string, Record<string, boolean>> }

describe.skipIf(!hasDatabase)('PATCH /admin/admins/:id', () => {
  let chief: { id: string }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    tokens = new Map()
    chief = await createAdmin(app.pg, { isSuperadmin: true })
  })

  const plain = (options: Parameters<typeof createAdmin>[1] = {}) => createAdmin(app.pg, { isAdmin: false, ...options })
  // One session per staff account (the index allows no more), so a second `bearerFor`
  // for the same account would end the first: mint once and reuse.
  let tokens = new Map<string, string>()
  const auth = async (id: string) => {
    if (!tokens.has(id)) tokens.set(id, (await bearerFor(app, { accountId: id, accountKind: 'admin' })).authorization)
    return { authorization: tokens.get(id)! }
  }
  const list = async (callerId: string) =>
    (await app.inject({ method: 'GET', url: '/admin/admins', headers: await auth(callerId) })).json().admins as Account[]
  const versionOf = async (callerId: string, id: string) => (await list(callerId)).find((a) => a.id === id)!.version
  const patch = async (headers: Record<string, string>, id: string, body: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/admin/admins/${id}`, headers, payload: body })
  const faultsAs = async (id: string) =>
    (await app.inject({ method: 'GET', url: '/admin/server-faults', headers: await auth(id) })).statusCode
  const audits = async (action: string) =>
    (await app.pg.query('SELECT outcome, detail, actor_id, target_id FROM audit_log WHERE action = $1 ORDER BY occurred_at', [action])).rows

  it('a grant takes effect on the account\'s very next request, and removing it takes effect as fast', async () => {
    const staff = await plain()
    const headers = await auth(chief.id)
    expect(await faultsAs(staff.id)).toBe(403)

    const granted = await patch(headers, staff.id, { version: await versionOf(chief.id, staff.id), grants: { server_faults: READ } })
    expect(granted.statusCode).toBe(200)
    expect(granted.json().grants.server_faults).toEqual(READ)
    expect(await faultsAs(staff.id)).toBe(200)

    const removed = await patch(headers, staff.id, { version: granted.json().version, grants: { server_faults: NONE } })
    expect(removed.statusCode).toBe(200)
    expect(removed.json().grants).toEqual({})
    // The row is deleted, not left as five falses: absence is denial, and the page and resolver agree.
    const { rows } = await app.pg.query('SELECT 1 FROM admin_permissions WHERE admin_user_id = $1', [staff.id])
    expect(rows).toHaveLength(0)
    expect(await faultsAs(staff.id)).toBe(403)
  })

  it('moves an account between roles, by the flags', async () => {
    const staff = await plain()
    const headers = await auth(chief.id)
    const flags = async () =>
      (await app.pg.query('SELECT is_admin, is_superadmin FROM admin_users WHERE id = $1', [staff.id])).rows[0]
    let version = await versionOf(chief.id, staff.id)

    for (const [role, expected] of [
      ['administrator', { is_admin: true, is_superadmin: false }],
      ['superadmin', { is_admin: true, is_superadmin: true }],
      ['staff', { is_admin: false, is_superadmin: false }],
    ] as const) {
      const response = await patch(headers, staff.id, { version, role })
      expect(response.statusCode, role).toBe(200)
      expect(response.json().role).toBe(role)
      expect(await flags()).toEqual(expected)
      version = response.json().version
    }
  })

  it('deactivating refuses the account on its next request, and reactivating restores it', async () => {
    const staff = await plain({ grants: { server_faults: { read: true } } })
    const headers = await auth(chief.id)
    expect(await faultsAs(staff.id)).toBe(200)

    const off = await patch(headers, staff.id, { version: await versionOf(chief.id, staff.id), isActive: false })
    expect(off.statusCode).toBe(200)
    expect(off.json().isActive).toBe(false)
    expect(await faultsAs(staff.id)).toBeGreaterThanOrEqual(401)

    const on = await patch(headers, staff.id, { version: off.json().version, isActive: true })
    expect(on.statusCode).toBe(200)
    expect(await faultsAs(staff.id)).toBe(200)
  })

  it('refuses a superadmin demoting or deactivating their own account', async () => {
    const second = await createAdmin(app.pg, { isSuperadmin: true })
    const headers = await auth(chief.id)
    const version = await versionOf(chief.id, chief.id)
    for (const body of [{ role: 'staff' }, { isActive: false }]) {
      const response = await patch(headers, chief.id, { version, ...body })
      expect(response.statusCode).toBe(403)
      expect(response.json().type).toBe(PROBLEMS.CANNOT_CHANGE_SELF.type)
    }
    // Counter-assertion: the same superadmin may demote the OTHER one.
    const other = await patch(headers, second.id, { version: await versionOf(chief.id, second.id), role: 'administrator' })
    expect(other.statusCode).toBe(200)
    const { rows } = await app.pg.query('SELECT is_superadmin FROM admin_users WHERE id = $1', [chief.id])
    expect(rows[0].is_superadmin).toBe(true)
  })

  it('refuses to demote or deactivate the ONLY active superadmin, with the reason a console can show', async () => {
    const headers = await auth(chief.id)
    const response = await patch(headers, chief.id, { version: await versionOf(chief.id, chief.id), role: 'administrator' })
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toBe(PROBLEMS.LAST_SUPERADMIN.type)
    const { rows } = await app.pg.query('SELECT is_superadmin, is_active FROM admin_users WHERE id = $1', [chief.id])
    expect(rows[0]).toEqual({ is_superadmin: true, is_active: true })
  })

  it('two superadmins demoting each other at once cannot leave the club without one', async () => {
    const second = await createAdmin(app.pg, { isSuperadmin: true })
    const aHeaders = await auth(chief.id)
    const bHeaders = await auth(second.id)
    const [versionB, versionA] = await Promise.all([versionOf(chief.id, second.id), versionOf(chief.id, chief.id)])

    const results = await Promise.all([
      patch(aHeaders, second.id, { version: versionB, role: 'administrator' }),
      patch(bHeaders, chief.id, { version: versionA, role: 'administrator' }),
    ])
    const codes = results.map((r) => r.statusCode).sort()
    expect(codes.filter((c) => c === 200)).toHaveLength(1)
    expect(codes.filter((c) => c === 200 || c === 403 || c === 409)).toHaveLength(2)
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM admin_users WHERE is_superadmin AND is_active')
    expect(rows[0].n).toBe(1)
    // The loser got a refusal a console can branch on, not a 500.
    expect(results.every((r) => r.statusCode < 500)).toBe(true)
  })

  it('a non-superadmin holding every flag on admins manages plain staff, and nothing else', async () => {
    const manager = await plain({ grants: { admins: true } })
    const staff = await plain()
    const administrator = await createAdmin(app.pg, { isAdmin: true })
    const headers = await auth(manager.id)

    const ok = await patch(headers, staff.id, { version: await versionOf(manager.id, staff.id), grants: { server_faults: READ } })
    expect(ok.statusCode).toBe(200)
    expect(await faultsAs(staff.id)).toBe(200)

    const onAdministrator = await patch(headers, administrator.id, { version: await versionOf(chief.id, administrator.id), isActive: false })
    expect(onAdministrator.statusCode).toBe(403)
    expect(onAdministrator.json().type).toBe(PROBLEMS.CANNOT_MANAGE_ADMIN.type)

    // Promoting anyone, including yourself, is a superadmin act...
    const promote = await patch(headers, staff.id, { version: ok.json().version, role: 'administrator' })
    expect(promote.statusCode).toBe(403)
    expect(promote.json().type).toBe(PROBLEMS.CANNOT_MANAGE_ADMIN.type)
    // ...and so is granting yourself more than you hold.
    const self = await patch(headers, manager.id, { version: await versionOf(manager.id, manager.id), grants: { members: READ } })
    expect(self.statusCode).toBe(403)
    expect(self.json().type).toBe(PROBLEMS.CANNOT_CHANGE_SELF.type)
    const { rows } = await app.pg.query('SELECT module FROM admin_permissions WHERE admin_user_id = $1', [manager.id])
    expect(rows.map((r) => r.module)).toEqual(['admins'])
  })

  it('refuses a stale version and changes nothing; a successful change bumps it', async () => {
    const staff = await plain()
    const headers = await auth(chief.id)
    const first = await versionOf(chief.id, staff.id)

    const one = await patch(headers, staff.id, { version: first, grants: { server_faults: READ } })
    expect(one.statusCode).toBe(200)
    expect(one.json().version).not.toBe(first)

    const stale = await patch(headers, staff.id, { version: first, isActive: false })
    expect(stale.statusCode).toBe(409)
    expect(stale.json().type).toBe(PROBLEMS.CONFLICT.type)
    const { rows } = await app.pg.query('SELECT is_active FROM admin_users WHERE id = $1', [staff.id])
    expect(rows[0].is_active).toBe(true)
  })

  it('answers an unknown id and an invalid one the same way, and rejects malformed requests', async () => {
    const headers = await auth(chief.id)
    const staff = await plain()
    const version = await versionOf(chief.id, staff.id)
    const unknown = await patch(headers, '00000000-0000-4000-8000-000000000000', { version, isActive: false })
    expect(unknown.statusCode).toBe(404)
    expect(unknown.json().type).toBe(PROBLEMS.NOT_FOUND.type)

    for (const body of [
      { version },                                                        // nothing to change
      { version, grants: { not_an_area: READ } },                         // unknown area
      { version, grants: { server_faults: { ...READ, read: 'yes' } } },   // not a boolean
      { version, role: 'emperor' },
      { isActive: false },                                                // no version
    ]) {
      const response = await patch(headers, staff.id, body)
      expect(response.statusCode, JSON.stringify(body)).toBeGreaterThanOrEqual(400)
      expect(response.statusCode, JSON.stringify(body)).toBeLessThan(500)
    }
    // Counter-assertion: none of the above changed the account.
    const { rows } = await app.pg.query('SELECT is_active, is_admin FROM admin_users WHERE id = $1', [staff.id])
    expect(rows[0]).toEqual({ is_active: true, is_admin: false })
  })

  it('audits every change with before and after of only what changed, and every refusal as denied', async () => {
    const staff = await plain({ grants: { seo: { read: true } } })
    const headers = await auth(chief.id)
    const response = await patch(headers, staff.id, {
      version: await versionOf(chief.id, staff.id), isActive: false, grants: { server_faults: READ },
    })
    expect(response.statusCode).toBe(200)

    const done = await audits('admin_updated')
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject({ outcome: 'allowed', actor_id: chief.id, target_id: staff.id })
    expect(done[0].detail.adminChange).toEqual({
      before: { isActive: true, grants: { server_faults: null } },
      after: { isActive: false, grants: { server_faults: READ } },
    })
    // The untouched area and the untouched role are not in the entry.
    expect(JSON.stringify(done[0].detail)).not.toContain('seo')
    expect(JSON.stringify(done[0].detail)).not.toContain('role')

    // A refusal leaves a denied entry and no allowed one (counter-assertion).
    await patch(headers, chief.id, { version: await versionOf(chief.id, chief.id), role: 'staff' })
    expect(await audits('admin_updated')).toHaveLength(1)
    const refused = await app.pg.query(`SELECT outcome FROM audit_log WHERE outcome = 'denied' AND target_id = $1`, [chief.id])
    expect(refused.rows.length).toBeGreaterThan(0)
  })
})
