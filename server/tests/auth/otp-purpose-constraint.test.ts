import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043, the one database change (research R1): `otp_challenges.purpose` is
 * guarded by a CHECK that names the purposes a code may be issued for, and a reset
 * code needs a fifth. This is the test that makes the widening a statement rather
 * than a side effect of a migration.
 *
 * The rule is widened, not removed. A purpose is what stops a code issued for one
 * thing being spent at an endpoint for another (a reset code must never open a
 * session), so the constraint still refuses anything it does not know, and that is
 * asserted below as hard as the acceptance is.
 *
 * Raw INSERTs, not `issueChallenge`: this is about the table's own rule, and it
 * must hold for any writer, including one that bypasses the application.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const EXISTING = ['login', 'device_approval', 'mobile_verification', 'email_verification'] as const
const ALL = [...EXISTING, 'password_reset'].sort()

describe.skipIf(!hasDatabase)('otp_challenges_purpose_check', () => {
  let memberId: string

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    memberId = (await createMember(app.pg, { mobile: '+4915112345678', mobileVerified: true })).id
  })

  const insert = (purpose: string) =>
    app.pg.query(
      `INSERT INTO otp_challenges (account_id, account_kind, code_hash, device_id, purpose, expires_at)
       VALUES ($1, 'member', '\\x00'::bytea, 'device-under-test', $2, now() + interval '5 minutes')`,
      [memberId, purpose],
    )

  it.each(EXISTING)('still accepts the existing purpose %s', async (purpose) => {
    await expect(insert(purpose)).resolves.toBeDefined()
  })

  it('accepts the new purpose, password_reset', async () => {
    await expect(insert('password_reset')).resolves.toBeDefined()
    const { rows } = await app.pg.query(
      `SELECT purpose FROM otp_challenges WHERE account_id = $1`, [memberId],
    )
    expect(rows.map((r) => r.purpose)).toEqual(['password_reset'])
  })

  // The counter-assertion: without it this file would pass against a migration that
  // simply dropped the constraint, which is the unsafe version of "no purpose rule".
  it('still refuses a purpose it does not know, by name', async () => {
    await expect(insert('nonsense')).rejects.toMatchObject({
      code: '23514', // check_violation
      constraint: 'otp_challenges_purpose_check',
    })
    // And it wrote nothing.
    const { rows } = await app.pg.query('SELECT count(*)::int AS n FROM otp_challenges WHERE account_id = $1', [memberId])
    expect(rows[0].n).toBe(0)
  })

  it('lists exactly the five purposes, no more', async () => {
    const { rows } = await app.pg.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'otp_challenges_purpose_check'`,
    )
    expect(rows).toHaveLength(1)
    const listed = [...String(rows[0].def).matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
    expect(listed).toEqual(ALL)
  })
})
