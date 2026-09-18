import { query } from '../../../db/query.ts'

/**
 * Entitlement at point of use (FR-013, §12.2).
 *
 * No membership-card table is in scope, so this resolves to `null`. It exists
 * now so the *contract* is fixed here: entitlement is looked up from the
 * card's validity window at the moment it is needed, and the card feature
 * supplies a query rather than a new rule. A cached tier column is exactly
 * how a lapsed card would keep granting free events.
 */
export async function resolveEntitlement() {
  return null
}

/**
 * The ONLY place capabilities and entitlement cross the wire, and both are
 * computed at request time. Clients use this to decide what to *display*;
 * they never use it to decide what is *allowed*.
 */
export async function loadMe(app, { principal, signal }) {
  if (principal.kind === 'admin') {
    const snapshot = await app.permissions.resolve(principal.id, { signal })
    return {
      kind: 'admin',
      id: principal.id,
      displayName: snapshot.displayName ?? null,
      isAdmin: snapshot.isAdmin,
      isSuperadmin: snapshot.isSuperadmin,
      modules: snapshot.modules,
    }
  }

  const { rows } = await query(
    app.pg,
    'SELECT display_name, email_confirmed_at, permissions FROM members WHERE id = $1',
    [principal.id],
    { signal },
  )
  const member = rows[0] ?? {}
  return {
    kind: 'member',
    id: principal.id,
    displayName: member.display_name ?? null,
    emailConfirmed: member.email_confirmed_at !== null && member.email_confirmed_at !== undefined,
    permissions: Object.entries(member.permissions ?? {}).filter(([, v]) => v === true).map(([k]) => k),
    entitlement: await resolveEntitlement(principal.id),
  }
}
