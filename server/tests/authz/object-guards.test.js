import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  guardAdminTarget, guardSelfDemotion, guardLastSuperadmin,
  guardMemberDeletion, guardOwnedContent, guardSeoEdit, seoModulesFor,
} from '../../src/authz/object-guards.js'
import { FLAGS, MODULES, NO_GRANT } from '@gwc/contracts/permissions'

/**
 * FR-009 — the one privilege-escalation path in the model, and the sharpest
 * check in the suite.
 *
 * §11: "Lower-privileged staff can never edit or remove admin/superadmin
 * accounts or their permissions; only a superadmin can manage other admins."
 *
 * The reason this cannot live in a route declaration is the reason it needs its
 * own file: a route declaring `{ module: 'admins', flag: 'edit' }` looks
 * correctly guarded to a reviewer reading route declarations. The escalation —
 * a department admin with `admins.edit` granting themselves superadmin — is
 * invisible at that level and only closes at the object.
 */

const allModules = (value) =>
  Object.fromEntries(MODULES.map((m) => [m, Object.fromEntries(FLAGS.map((f) => [f, value]))]))

const snapshot = (over = {}) => ({
  adminId: randomUUID(),
  isActive: true,
  isAdmin: true,
  isSuperadmin: false,
  modules: allModules(false),
  ...over,
})

/** A stub app: the guards' only collaborator is the audit writer. */
const stubApp = () => ({ auditDenial: vi.fn(async () => {}) })
const request = () => ({ id: 'req-1', principal: { id: 'p1', kind: 'admin' } })

describe('guardAdminTarget (FR-009)', () => {
  it('REFUSES a department admin holding all five flags on `admins`', async () => {
    const app = stubApp()
    const actor = snapshot({ modules: { ...allModules(false), admins: Object.fromEntries(FLAGS.map((f) => [f, true])) } })
    const target = { id: randomUUID(), is_admin: true, is_superadmin: false }

    await expect(guardAdminTarget(app, request(), actor, target)).rejects.toMatchObject({ statusCode: 403 })
    expect(app.auditDenial).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ requiredPermission: 'superadmin', targetId: target.id }),
    )
  })

  it('refuses when the target is a superadmin', async () => {
    const target = { id: randomUUID(), is_admin: false, is_superadmin: true }
    await expect(guardAdminTarget(stubApp(), request(), snapshot(), target)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a superadmin to manage another admin', async () => {
    const target = { id: randomUUID(), is_admin: true, is_superadmin: false }
    await expect(guardAdminTarget(stubApp(), request(), snapshot({ isSuperadmin: true }), target)).resolves.toBeUndefined()
  })

  it('allows a department admin to act on a NON-admin target', async () => {
    const target = { id: randomUUID(), is_admin: false, is_superadmin: false }
    await expect(guardAdminTarget(stubApp(), request(), snapshot(), target)).resolves.toBeUndefined()
  })

  it('does not consult the actor’s flags at all — that is the point', async () => {
    const withFlags = snapshot({ modules: allModules(true) })
    const target = { id: randomUUID(), is_admin: true, is_superadmin: false }
    await expect(guardAdminTarget(stubApp(), request(), withFlags, target)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('names the problem type a client can branch on', async () => {
    const target = { id: randomUUID(), is_admin: true }
    await expect(guardAdminTarget(stubApp(), request(), snapshot(), target))
      .rejects.toMatchObject({ problem: expect.objectContaining({ type: expect.stringContaining('cannot-manage-admin') }) })
  })
})

describe('guardSelfDemotion (§11 recoverability)', () => {
  it('refuses an admin removing their own superadmin status', async () => {
    const actor = snapshot({ isSuperadmin: true })
    const target = { id: actor.adminId, is_superadmin: true, is_active: true }
    await expect(guardSelfDemotion(stubApp(), request(), actor, target, { is_superadmin: false }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses an admin deactivating their own account', async () => {
    const actor = snapshot({ isSuperadmin: true })
    const target = { id: actor.adminId, is_superadmin: true, is_active: true }
    await expect(guardSelfDemotion(stubApp(), request(), actor, target, { is_active: false }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows a superadmin to demote someone else', async () => {
    const actor = snapshot({ isSuperadmin: true })
    const target = { id: randomUUID(), is_superadmin: true, is_active: true }
    await expect(guardSelfDemotion(stubApp(), request(), actor, target, { is_superadmin: false })).resolves.toBeUndefined()
  })
})

describe('guardLastSuperadmin', () => {
  const client = (remaining) => ({ query: async () => ({ rows: [{ remaining }] }) })

  it('refuses when no other active superadmin remains', async () => {
    const target = { id: randomUUID(), is_superadmin: true, is_active: true }
    await expect(guardLastSuperadmin(client(0), target, { is_superadmin: false }))
      .rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows the demotion when another remains', async () => {
    const target = { id: randomUUID(), is_superadmin: true, is_active: true }
    await expect(guardLastSuperadmin(client(1), target, { is_superadmin: false })).resolves.toBeUndefined()
  })

  it('ignores changes that do not remove superadmin status', async () => {
    const target = { id: randomUUID(), is_superadmin: true, is_active: true }
    await expect(guardLastSuperadmin(client(0), target, { display_name: 'x' })).resolves.toBeUndefined()
  })
})

describe('guardMemberDeletion (§12.4)', () => {
  it('always refuses, naming the status transition instead', () => {
    expect(() => guardMemberDeletion()).toThrow(/status change/i)
  })
})

describe('guardOwnedContent (§7)', () => {
  it('allows a member to act on their own content', async () => {
    const req = { id: 'r', principal: { id: 'm1', kind: 'member' } }
    await expect(guardOwnedContent(stubApp(), req, { ownerId: 'm1' })).resolves.toBeUndefined()
  })

  it('refuses a member acting on another member’s content', async () => {
    const req = { id: 'r', principal: { id: 'm1', kind: 'member' } }
    await expect(guardOwnedContent(stubApp(), req, { ownerId: 'm2' })).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets staff through — they arrived via the module flag, not ownership', async () => {
    const req = { id: 'r', principal: { id: 'a1', kind: 'admin' } }
    await expect(guardOwnedContent(stubApp(), req, { ownerId: 'm2' })).resolves.toBeUndefined()
  })
})

describe('guardSeoEdit (§10.8) — the flag on BOTH modules', () => {
  it('maps each record type to its own module', () => {
    expect(seoModulesFor('partner')).toEqual({ seo: 'seo', record: 'partners' })
    expect(seoModulesFor('article')).toEqual({ seo: 'seo', record: 'magazine' })
    expect(seoModulesFor('event')).toEqual({ seo: 'seo', record: 'events' })
  })

  it('refuses seo.edit alone — otherwise it is edit access to every title on the site', async () => {
    const actor = snapshot({ modules: { ...allModules(false), seo: { ...NO_GRANT, edit: true } } })
    await expect(guardSeoEdit(stubApp(), request(), actor, 'partner')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses partners.edit alone', async () => {
    const actor = snapshot({ modules: { ...allModules(false), partners: { ...NO_GRANT, edit: true } } })
    await expect(guardSeoEdit(stubApp(), request(), actor, 'partner')).rejects.toMatchObject({ statusCode: 403 })
  })

  it('allows the edit when BOTH are granted', async () => {
    const actor = snapshot({
      modules: {
        ...allModules(false),
        seo: { ...NO_GRANT, edit: true },
        partners: { ...NO_GRANT, edit: true },
      },
    })
    await expect(guardSeoEdit(stubApp(), request(), actor, 'partner')).resolves.toBeUndefined()
  })

  it('lets a superadmin through without either', async () => {
    await expect(guardSeoEdit(stubApp(), request(), snapshot({ isSuperadmin: true }), 'partner')).resolves.toBeUndefined()
  })
})
