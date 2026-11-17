import { describe, it, expect } from 'vitest'
import { constraintsFor, roleOf } from '../../src/modules/admins/application/constraints.ts'

/**
 * Feature 028 — every row of the rule table, as a unit test.
 * The pairs below are (actor, target, count of active superadmins) → expected.
 */
const SUPER = { adminId: 's1', isSuperadmin: true }
const OTHER_SUPER = { id: 's2', isAdmin: true, isSuperadmin: true, isActive: true }
const ME_SUPER = { id: 's1', isAdmin: true, isSuperadmin: true, isActive: true }
const ADMINISTRATOR = { id: 'a1', isAdmin: true, isSuperadmin: false, isActive: true }
const STAFF = { id: 'u1', isAdmin: false, isSuperadmin: false, isActive: true }
const DEPT = { adminId: 'u9', isSuperadmin: false }

const allowed = { allowed: true }
const blocked = (reason: string) => ({ allowed: false, reason })

describe('roleOf', () => {
  it('derives the role from the two flags', () => {
    expect(roleOf({ isAdmin: true, isSuperadmin: true })).toBe('superadmin')
    expect(roleOf({ isAdmin: false, isSuperadmin: true })).toBe('superadmin')
    expect(roleOf({ isAdmin: true, isSuperadmin: false })).toBe('administrator')
    expect(roleOf({ isAdmin: false, isSuperadmin: false })).toBe('staff')
  })
})

describe('a superadmin acting on others', () => {
  it('may do everything to a plain staff account (counter-assertion for the blocks below)', () => {
    expect(constraintsFor({ actor: SUPER, target: STAFF, activeSuperadmins: 1 }))
      .toEqual({ changeRole: allowed, setActive: allowed, editGrants: allowed })
  })
  it('may do everything to an administrator', () => {
    expect(constraintsFor({ actor: SUPER, target: ADMINISTRATOR, activeSuperadmins: 1 }))
      .toEqual({ changeRole: allowed, setActive: allowed, editGrants: allowed })
  })
  it('may demote and deactivate another superadmin while a second one remains', () => {
    expect(constraintsFor({ actor: SUPER, target: OTHER_SUPER, activeSuperadmins: 2 }))
      .toEqual({ changeRole: allowed, setActive: allowed, editGrants: allowed })
  })
  it('may not demote or deactivate the ONLY active superadmin', () => {
    expect(constraintsFor({ actor: { adminId: 'x', isSuperadmin: true }, target: OTHER_SUPER, activeSuperadmins: 1 }))
      .toEqual({ changeRole: blocked('last-superadmin'), setActive: blocked('last-superadmin'), editGrants: allowed })
  })
  it('an inactive superadmin is not "the last one": reactivating or demoting it is fine', () => {
    expect(constraintsFor({ actor: SUPER, target: { ...OTHER_SUPER, isActive: false }, activeSuperadmins: 1 }))
      .toEqual({ changeRole: allowed, setActive: allowed, editGrants: allowed })
  })
})

describe('a superadmin acting on themselves', () => {
  it('may not demote or deactivate themselves while other superadmins exist', () => {
    expect(constraintsFor({ actor: SUPER, target: ME_SUPER, activeSuperadmins: 3 }))
      .toEqual({ changeRole: blocked('self'), setActive: blocked('self'), editGrants: allowed })
  })
  it('names last-superadmin before self when both apply (the useful reason for the only superadmin)', () => {
    expect(constraintsFor({ actor: SUPER, target: ME_SUPER, activeSuperadmins: 1 }))
      .toMatchObject({ changeRole: blocked('last-superadmin'), setActive: blocked('last-superadmin') })
  })
})

describe('a non-superadmin (holding every flag on admins)', () => {
  it('may edit grants and active state of plain staff, but never roles', () => {
    expect(constraintsFor({ actor: DEPT, target: STAFF, activeSuperadmins: 1 }))
      .toEqual({ changeRole: blocked('superadmin-required'), setActive: allowed, editGrants: allowed })
  })
  it('may do nothing to an administrator or a superadmin', () => {
    for (const target of [ADMINISTRATOR, OTHER_SUPER]) {
      expect(constraintsFor({ actor: DEPT, target, activeSuperadmins: 2 }))
        .toEqual({ changeRole: blocked('superadmin-required'), setActive: blocked('superadmin-required'), editGrants: blocked('superadmin-required') })
    }
  })
  it('may not edit their OWN grants or active state (otherwise admins.edit is grant-yourself-everything)', () => {
    const me = { id: 'u9', isAdmin: false, isSuperadmin: false, isActive: true }
    expect(constraintsFor({ actor: DEPT, target: me, activeSuperadmins: 1 }))
      .toEqual({ changeRole: blocked('superadmin-required'), setActive: blocked('self'), editGrants: blocked('self') })
  })
})
