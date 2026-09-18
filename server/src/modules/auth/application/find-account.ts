import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Account lookup shared by sign-in and password-reset request.
 *
 * Members, admins, then organisation principals (merchants/partners) — the
 * smallest population, resolved last, riding the same sessions and refresh
 * rotation rather than a parallel auth path. `email` is unique per
 * organisation rather than globally, so the first active row wins for
 * sign-in; picking among several is a later problem, never a credential's to
 * answer.
 */
export async function findAccount(app: GwcApp, email, signal) {
  const { rows: members } = await query(
    app.pg,
    `SELECT id, email, password_hash, password_reset_required, status, email_confirmed_at,
            mobile, mobile_verified_at, display_name
       FROM members WHERE email = $1`,
    [email],
    { signal },
  )
  if (members.length > 0) return { kind: 'member', row: members[0] }

  const { rows: admins } = await query(
    app.pg,
    'SELECT id, email, password_hash, is_active, is_admin, is_superadmin, display_name FROM admin_users WHERE email = $1',
    [email],
    { signal },
  )
  if (admins.length > 0) return { kind: 'admin', row: admins[0] }

  const { rows: orgUsers } = await query(
    app.pg,
    `SELECT ou.id, ou.email, ou.password_hash, ou.status, ou.role, ou.display_name,
            ou.organisation_id, o.kind AS organisation_kind, o.status AS organisation_status,
            o.legal_name AS organisation_name
       FROM organisation_users ou
       JOIN organisations o ON o.id = ou.organisation_id
      WHERE ou.email = $1
      ORDER BY (ou.status = 'active') DESC, ou.created_at ASC
      LIMIT 1`,
    [email],
    { signal },
  )
  if (orgUsers.length > 0) {
    return { kind: orgUsers[0].organisation_kind, row: orgUsers[0] }
  }

  return null
}
