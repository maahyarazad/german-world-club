import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, bearerFor, createAdmin, createMember, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 028, US2 — the administrator list.
 *
 * Besides what it shows, the list is tested for what it must NOT show: it is
 * built from the table that holds the password hash, and a non-superadmin must
 * not even see the accounts they could not manage.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

type Row = {
  id: string; email: string; role: string; isActive: boolean; version: string; current: boolean
  grants: Record<string, Record<string, boolean>>
  constraints: Record<string, { allowed: boolean; reason?: string }>
}

describe.skipIf(!hasDatabase)('GET /admin/admins', () => {
  let superadmin: { id: string; email: string }
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    superadmin = await createAdmin(app.pg, { isSuperadmin: true, displayName: 'Chief' })
  })

  /** `createAdmin` defaults to is_admin = true; plain staff must say so. */
  const plain = (options: Parameters<typeof createAdmin>[1] = {}) => createAdmin(app.pg, { isAdmin: false, ...options })

  const get = async (accountId: string) => {
    const headers = await bearerFor(app, { accountId, accountKind: 'admin' })
    return app.inject({ method: 'GET', url: '/admin/admins', headers: { authorization: headers.authorization } })
  }

  it('lists every account with role, state, grants, version and the caller marked', async () => {
    const administrator = await createAdmin(app.pg, { isAdmin: true, grants: { members: true } })
    const staff = await plain({ grants: { events: { read: true, status: true }, seo: { read: true } } })
    const inactive = await plain({ isActive: false })

    const response = await get(superadmin.id)
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    const rows = response.json().admins as Row[]
    expect(rows).toHaveLength(4)
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))

    expect(byId[superadmin.id]).toMatchObject({ role: 'superadmin', isActive: true, current: true })
    expect(byId[administrator.id]).toMatchObject({ role: 'administrator', current: false })
    expect(byId[staff.id]).toMatchObject({ role: 'staff', isActive: true })
    expect(byId[inactive.id]).toMatchObject({ isActive: false })

    // Only areas with a true flag appear; absence is denial.
    expect(Object.keys(byId[staff.id]!.grants).sort()).toEqual(['events', 'seo'])
    expect(byId[staff.id]!.grants.events).toEqual({ read: true, write: false, edit: false, delete: false, status: true })
    expect(byId[inactive.id]!.grants).toEqual({})
    expect(byId[administrator.id]!.grants.members).toEqual({ read: true, write: true, edit: true, delete: true, status: true })

    // Superadmins first, then administrators, then staff.
    expect(rows[0]!.role).toBe('superadmin')
    expect(rows[1]!.role).toBe('administrator')
    expect(typeof byId[staff.id]!.version).toBe('string')
  })

  it('computes, per account, what may be changed and why not (the server decides, once)', async () => {
    const staff = await plain()
    const rows = (await get(superadmin.id)).json().admins as Row[]
    const self = rows.find((r) => r.id === superadmin.id)!
    const other = rows.find((r) => r.id === staff.id)!

    // The only active superadmin, and the caller: "at least one must remain" is the reason.
    expect(self.constraints.changeRole).toEqual({ allowed: false, reason: 'last-superadmin' })
    expect(self.constraints.setActive).toEqual({ allowed: false, reason: 'last-superadmin' })
    expect(self.constraints.editGrants).toEqual({ allowed: true })
    // Counter-assertion: nothing is blocked on a plain staff account.
    expect(other.constraints).toEqual({ changeRole: { allowed: true }, setActive: { allowed: true }, editGrants: { allowed: true } })

    // A second superadmin looking at the first: the first is no longer the only one, so changeable.
    const second = await createAdmin(app.pg, { isSuperadmin: true })
    const fromSecond = (await get(second.id)).json().admins as Row[]
    expect(fromSecond.find((r) => r.id === superadmin.id)!.constraints.changeRole).toEqual({ allowed: true })
    // And with two superadmins the caller's own row now says "self", not "last".
    expect(fromSecond.find((r) => r.id === second.id)!.constraints.changeRole).toEqual({ allowed: false, reason: 'self' })
  })

  it('never sends a password hash, a creator, a session or a token', async () => {
    await plain({ grants: { members: true } })
    const text = (await get(superadmin.id)).body
    for (const forbidden of ['password', 'hash', 'argon', 'created_by', 'createdBy', 'session', 'token', 'refresh']) {
      expect(text.toLowerCase(), forbidden).not.toContain(forbidden)
    }
  })

  it('shows a non-superadmin only the accounts they could manage (counter-assertion: the superadmin sees all)', async () => {
    const staffA = await plain({ grants: { events: true } })
    const administrator = await createAdmin(app.pg, { isAdmin: true })
    const manager = await plain({ grants: { admins: true } })

    const rows = (await get(manager.id)).json().admins as Row[]
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(staffA.id)
    expect(ids).toContain(manager.id)
    expect(ids).not.toContain(administrator.id)
    expect(ids).not.toContain(superadmin.id)
    expect(rows.every((r) => r.role === 'staff')).toBe(true)
    // ...and what they see about themselves is blocked from the self-escalation routes.
    const me = rows.find((r) => r.id === manager.id)!
    expect(me.constraints.editGrants).toEqual({ allowed: false, reason: 'self' })
    expect(me.constraints.changeRole).toEqual({ allowed: false, reason: 'superadmin-required' })
    expect((await get(superadmin.id)).json().admins).toHaveLength(4)
  })

  it('makes the module available, and refuses a member, an unauthenticated caller and a staff member with no grant', async () => {
    const session = await app.inject({
      method: 'GET', url: '/auth/session',
      headers: { authorization: (await bearerFor(app, { accountId: superadmin.id, accountKind: 'admin' })).authorization },
    })
    expect(session.json().available).toContain('admins')

    const member = await createMember(app.pg)
    const memberHeaders = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    expect((await app.inject({ method: 'GET', url: '/admin/admins', headers: { authorization: memberHeaders.authorization } })).statusCode).toBeGreaterThanOrEqual(401)
    expect((await app.inject({ method: 'GET', url: '/admin/admins' })).statusCode).toBe(401)
    const bare = await plain()
    expect((await get(bare.id)).statusCode).toBe(403)
  })
})
