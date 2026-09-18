import { query } from '../db/query.ts'
import { FLAGS, MODULES, NO_GRANT } from '@gwc/contracts/permissions'

/**
 * The permission snapshot (FR-006, SC-003).
 *
 * Permissions are resolved **per request from server-held state**, never from
 * token claims. §11's matrix is staff-editable at any moment, and SC-003
 * requires a revocation to bite on the target's very next request — which a
 * claim baked into a ten-minute token cannot do.
 *
 * The cache exists so that does not mean a query per request. Its **explicit
 * invalidation** is the mechanism; the 30-second TTL is only a backstop for a
 * write this process did not see, such as one made by another instance or by
 * hand. Relying on the TTL alone would make SC-003 a 30-second promise rather
 * than a next-request one.
 */

export const SNAPSHOT_TTL_MS = 30_000

const emptyModules = () => Object.fromEntries(MODULES.map((m) => [m, { ...NO_GRANT }]))

export function createPermissionResolver(pool, { ttlMs = SNAPSHOT_TTL_MS, clock = Date.now } = {}) {
  /** @type {Map<string, {snapshot: object, at: number}>} */
  const cache = new Map()

  async function load(adminId, signal) {
    const { rows: accounts } = await query(
      pool,
      'SELECT id, is_admin, is_superadmin, is_active, display_name FROM admin_users WHERE id = $1',
      [adminId],
      { signal },
    )
    if (accounts.length === 0) {
      return { adminId, exists: false, isAdmin: false, isSuperadmin: false, isActive: false, modules: emptyModules() }
    }
    const account = accounts[0]

    const { rows: grants } = await query(
      pool,
      `SELECT module, can_read, can_write, can_edit, can_delete, can_status
         FROM admin_permissions WHERE admin_user_id = $1`,
      [adminId],
      { signal },
    )

    // Start from all-false for every module: an absent row is denial, never
    // inheritance and never a default.
    const modules = emptyModules()
    for (const g of grants) {
      modules[g.module] = {
        read: g.can_read, write: g.can_write, edit: g.can_edit,
        delete: g.can_delete, status: g.can_status,
      }
    }

    return {
      adminId,
      exists: true,
      displayName: account.display_name,
      isAdmin: account.is_admin,
      isSuperadmin: account.is_superadmin,
      isActive: account.is_active,
      modules,
    }
  }

  return {
    async resolve(adminId, { signal } = {}) {
      const hit = cache.get(adminId)
      if (hit && clock() - hit.at < ttlMs) return hit.snapshot
      const snapshot = await load(adminId, signal)
      cache.set(adminId, { snapshot, at: clock() })
      return snapshot
    },

    /**
     * Called on any write to `admin_permissions` or to an account's
     * `is_active` / `is_admin` / `is_superadmin`. This — not the TTL — is what
     * makes SC-003 hold.
     */
    invalidate(adminId) {
      cache.delete(adminId)
    },

    invalidateAll() {
      cache.clear()
    },

    /** Exposed for the revocation test, which asserts the cache is actually used. */
    size: () => cache.size,
  }
}

/** Does this snapshot permit `flag` on `module`? Superadmin bypasses the matrix (FR-008). */
export function permits(snapshot, module, flag) {
  if (!snapshot?.isActive) return false
  if (snapshot.isSuperadmin) return true
  if (!MODULES.includes(module) || !FLAGS.includes(flag)) return false
  return snapshot.modules[module]?.[flag] === true
}
