import { z } from 'zod'
import { FLAGS, MODULES } from './permissions.js'

/**
 * The capability snapshot: what a client may *display*.
 *
 * Imported by the server (to serialize `GET /auth/session`) and by the console
 * (to derive its navigation), so a module renamed in one place is a type error
 * in the other rather than an empty sidebar in production — Constitution
 * Principle I.
 *
 * This is NOT an authorization decision and must never be used as one. The
 * server re-checks every operation against live state; a client that trusted
 * this object would be the only barrier to an action, which is precisely the
 * defect Principle I exists to prevent. See
 * specs/003-web-console/contracts/capability-api.md.
 */

/** One module's five flags. */
export const moduleGrantSchema = z.object(
  Object.fromEntries(FLAGS.map((flag) => [flag, z.boolean()])),
)

/**
 * Only modules where at least one flag is true.
 *
 * Absence is denial — the same rule the permission tables use — so shipping
 * nineteen all-false objects would be noise that says exactly nothing, and
 * would invite a client to render a sidebar entry for every module in
 * existence.
 */
export const grantedModulesSchema = z.partialRecord(z.enum(MODULES), moduleGrantSchema)

/**
 * Modules that have a working server surface *today*.
 *
 * The permission matrix declares nineteen modules; the API serves a handful of
 * them. Without this list the console would have to hard-code which ones work,
 * and that list would drift from the server the moment a module landed. With
 * it, a module the principal holds a grant on but that has no endpoint renders
 * as "noch nicht verfügbar" — visible and honest rather than a dead link
 * (SC-001).
 */
export const availableModulesSchema = z.array(z.enum(MODULES))

const staffSession = z.object({
  kind: z.literal('staff'),
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  isSuperadmin: z.boolean(),
  modules: grantedModulesSchema,
  available: availableModulesSchema,
})

/**
 * An organisation principal — a club merchant or a corporate club partner.
 *
 * They hold no module matrix. Their reach is their own organisation and their
 * role within it, which is why `organisationId` is on the snapshot: every
 * query they make is scoped to it, enforced against the loaded target inside
 * the transaction because a route-level audience cannot express "yours".
 */
const organisationSession = z.object({
  kind: z.enum(['merchant', 'partner']),
  id: z.string().uuid(),
  displayName: z.string().nullable(),
  organisationId: z.string().uuid(),
  organisationName: z.string(),
  organisationStatus: z.enum(['pending', 'active', 'suspended', 'ended']),
  role: z.enum(['owner', 'manager', 'staff']),
  available: availableModulesSchema,
})

export const sessionResponseSchema = z.discriminatedUnion('kind', [
  staffSession,
  organisationSession,
])

/** Principal kinds the console routes on. `member` comes from `/auth/me`. */
export const CONSOLE_KINDS = Object.freeze(['member', 'staff', 'merchant', 'partner'])

/**
 * Where each principal kind lands after sign-in.
 *
 * Held here rather than in the client so the server and the console agree on
 * one answer. The server still never *tells* the client which URL to visit —
 * it answers with the principal kind and the client maps it — so a tampered
 * response cannot redirect a staff member anywhere.
 */
export const HOME_FOR_KIND = Object.freeze({
  member: '/konsole/mitglied',
  staff: '/konsole/admin',
  merchant: '/konsole/merchant',
  partner: '/konsole/partner',
})

/** True when the snapshot grants `flag` on `module`. Absence is denial. */
export function hasGrant(snapshot, module, flag) {
  if (!snapshot || snapshot.kind !== 'staff') return false
  return snapshot.modules?.[module]?.[flag] === true
}

/** True when the principal holds any flag at all on `module`. */
export function hasAnyGrant(snapshot, module) {
  if (!snapshot || snapshot.kind !== 'staff') return false
  const grant = snapshot.modules?.[module]
  return grant ? FLAGS.some((flag) => grant[flag] === true) : false
}

/** True when the server can actually serve `module` yet (SC-001). */
export function isAvailable(snapshot, module) {
  return Array.isArray(snapshot?.available) && snapshot.available.includes(module)
}
