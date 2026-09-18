import { randomUUID } from 'node:crypto'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { hashPassword } from '../../src/modules/auth/passwords.ts'
import { MODULES, FLAGS } from '@gwc/contracts/permissions'
import type { Pool } from 'pg'
import type { Module, Flag } from '@gwc/contracts/permissions'
import type { GwcApp } from '../../src/app.ts'

/**
 * Shared scaffolding for the authorization suites.
 *
 * The app is built through the same `buildApp` seam every other suite uses, so
 * these tests exercise the real plugin chain — the posture gate, the deadline
 * signal, the audit writer — rather than a hand-assembled subset that could
 * drift from what actually boots.
 */

export const PASSWORD = 'correct-horse-battery'

export async function buildAuthApp() {
  const app = await buildApp({ contentSource: createFixtureContentSource([]) })
  await app.ready()
  return app
}

/** Truncate everything these suites write, in dependency order. */
export async function resetAuthTables(pool: Pool) {
  await pool.query(`
    TRUNCATE refresh_tokens, sessions, otp_challenges, device_approvals,
             admin_permissions, password_reset_tokens, audit_log RESTART IDENTITY CASCADE`)
  // admin_users guards the last active superadmin (§11). A suite that made one
  // *is* the last one in a clean test database, so tearing it down trips the
  // trigger. Suspend it for the teardown only — the rule stays armed for every
  // assertion, which is where it has to hold.
  await pool.query(`ALTER TABLE admin_users DISABLE TRIGGER admin_users_superadmin_guard`)
  await pool.query('DELETE FROM admin_users WHERE email LIKE $1', ['%@test.invalid'])
  await pool.query(`ALTER TABLE admin_users ENABLE TRIGGER admin_users_superadmin_guard`)
  // members refuses DELETE by design (§12.4), so test members are disabled
  // rather than removed — which is itself a useful reminder of the rule.
  await pool.query(`ALTER TABLE members DISABLE TRIGGER members_refuse_delete`)
  await pool.query('DELETE FROM members WHERE email LIKE $1', ['%@test.invalid'])
  await pool.query(`ALTER TABLE members ENABLE TRIGGER members_refuse_delete`)
}

export type CreateMemberOptions = {
  email?: string
  password?: string
  status?: string
  emailConfirmed?: boolean
  mobile?: string | null
  mobileVerified?: boolean
  passwordResetRequired?: boolean
  /** Pass a precomputed hash to skip argon2, or null to leave it unset. */
  passwordHash?: string | null
  permissions?: Record<string, boolean>
  displayName?: string
}

export async function createMember(pool: Pool, {
  email = `member-${randomUUID()}@test.invalid`,
  password = PASSWORD,
  status = 'active',
  emailConfirmed = true,
  mobile = null,
  mobileVerified = false,
  passwordResetRequired = false,
  passwordHash,
  permissions = {},
  displayName = 'Test Member',
}: CreateMemberOptions = {}) {
  const hash = passwordHash !== undefined ? passwordHash : await hashPassword(password)
  const { rows } = await pool.query(
    `INSERT INTO members (email, password_hash, password_reset_required, status,
                          email_confirmed_at, mobile, mobile_verified_at, permissions, display_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, email`,
    [
      email, hash, passwordResetRequired, status,
      emailConfirmed ? new Date() : null,
      mobile, mobileVerified ? new Date() : null,
      JSON.stringify(permissions), displayName,
    ],
  )
  return { ...rows[0], password }
}

export async function createAdmin(pool: Pool, {
  email = `admin-${randomUUID()}@test.invalid`,
  password = PASSWORD,
  isAdmin = true,
  isSuperadmin = false,
  isActive = true,
  displayName = 'Test Admin',
  grants = {},
} = {}) {
  const hash = await hashPassword(password)
  const { rows } = await pool.query(
    `INSERT INTO admin_users (email, password_hash, is_admin, is_superadmin, is_active, display_name)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email`,
    [email, hash, isAdmin, isSuperadmin, isActive, displayName],
  )
  const admin = rows[0]!
  // Object.entries widens the key to string; the grants map is keyed by Module.
  for (const [module, flags] of Object.entries(grants) as [Module, true | Partial<Record<Flag, boolean>>][]) {
    await grant(pool, admin.id, module, flags)
  }
  return { ...admin, password }
}

/** Grant a set of flags on one module. `true` means all five. */
export async function grant(
  pool: Pool,
  adminId: string,
  module: Module,
  flags: true | Partial<Record<Flag, boolean>>,
) {
  const set: Partial<Record<Flag, boolean>> =
    flags === true ? Object.fromEntries(FLAGS.map((f) => [f, true])) : flags
  await pool.query(
    `INSERT INTO admin_permissions (admin_user_id, module, can_read, can_write, can_edit, can_delete, can_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (admin_user_id, module) DO UPDATE
       SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write,
           can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
           can_status = EXCLUDED.can_status, updated_at = now()`,
    [adminId, module, !!set.read, !!set.write, !!set.edit, !!set.delete, !!set.status],
  )
}

export const ALL_MODULES = MODULES

/** Sign in through the real endpoint and return whatever the client would hold. */
export async function signIn(
  app: GwcApp,
  email: string,
  password: string = PASSWORD,
  extra: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: 'POST', url: '/auth/sign-in', payload: { email, password, ...extra },
  })
  return { statusCode: response.statusCode, body: response.json(), cookies: response.cookies, response }
}

/** A bearer header for a freshly-minted token on a real session. */
export async function bearerFor(
  app: GwcApp,
  { accountId, accountKind }: { accountId: string; accountKind: string },
) {
  // One active session per account (FR-004) is enforced by a partial unique
  // index, so minting a second bearer for the same account has to supersede the
  // first — exactly as a real second sign-in would. Without this a suite that
  // calls bearerFor twice fails on the constraint rather than on its assertion.
  await app.pg.query(
    `UPDATE sessions SET revoked_at = now(), revoked_reason = 'superseded'
      WHERE account_id = $1 AND account_kind = $2 AND revoked_at IS NULL`,
    [accountId, accountKind],
  )
  const { rows } = await app.pg.query(
    `INSERT INTO sessions (account_id, account_kind) VALUES ($1, $2) RETURNING id`,
    [accountId, accountKind],
  )
  const { token } = app.mintAccessToken({ accountId, sessionId: rows[0].id, audience: accountKind })
  return { authorization: `Bearer ${token}`, sessionId: rows[0].id }
}
