import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, signIn, PASSWORD } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { startSession } from '../../src/modules/auth/sessions.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * FR-004 / §12.7 — one active session per account.
 *
 * The rule is a **partial unique index**, not application logic. That is the
 * whole point of this file: two concurrent sign-ins become a constraint
 * violation the application handles deterministically, rather than a race whose
 * winner depends on timing and whose loser leaves a second live session behind.
 */
let app: GwcApp
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('single active session (FR-004)', () => {
  let member: Record<string, unknown>
  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
  })

  const activeSessions = async () => {
    const { rows } = await app.pg.query(
      'SELECT id, revoked_reason FROM sessions WHERE account_id = $1 AND revoked_at IS NULL',
      [member.id],
    )
    return rows
  }

  it('leaves exactly one active session after a sign-in', async () => {
    const result = await signIn(app, member.email)
    expect(result.statusCode).toBe(200)
    expect(result.body.outcome).toBe('authenticated')
    expect(await activeSessions()).toHaveLength(1)
  })

  it('revokes the first session as `superseded` when a second sign-in arrives', async () => {
    await signIn(app, member.email)
    const { rows: first } = await app.pg.query('SELECT id FROM sessions WHERE account_id = $1', [member.id])
    await signIn(app, member.email)

    const { rows: all } = await app.pg.query(
      'SELECT id, revoked_reason FROM sessions WHERE account_id = $1 ORDER BY created_at',
      [member.id],
    )
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe(first[0].id)
    expect(all[0].revoked_reason).toBe('superseded')
    expect(all[1].revoked_reason).toBeNull()
    expect(await activeSessions()).toHaveLength(1)
  })

  it('resolves two CONCURRENT sign-ins deterministically, through the index', async () => {
    const results = await Promise.allSettled([
      startSession(app.pg, { accountId: member.id, accountKind: 'member' }),
      startSession(app.pg, { accountId: member.id, accountKind: 'member' }),
    ])
    // Whatever the interleaving, the database's invariant holds: never two.
    expect(await activeSessions()).toHaveLength(1)
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true)
  })

  it('refuses a second active row even when inserted directly — the index is the rule', async () => {
    await startSession(app.pg, { accountId: member.id, accountKind: 'member' })
    await expect(
      app.pg.query('INSERT INTO sessions (account_id, account_kind) VALUES ($1, $2)', [member.id, 'member']),
    ).rejects.toMatchObject({ code: '23505' })
  })

  it('keeps sessions of different account kinds independent', async () => {
    await startSession(app.pg, { accountId: member.id, accountKind: 'member' })
    // The same uuid in the admin namespace is a different account entirely.
    await expect(
      app.pg.query('INSERT INTO sessions (account_id, account_kind) VALUES ($1, $2)', [member.id, 'admin']),
    ).resolves.toBeTruthy()
  })

  it('issues a refresh token whose plaintext is never stored', async () => {
    const { refreshToken } = await startSession(app.pg, { accountId: member.id, accountKind: 'member' })
    const { rows } = await app.pg.query('SELECT token_hash FROM refresh_tokens')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash.toString('utf8')).not.toContain(refreshToken)
    expect(rows[0].token_hash).toHaveLength(32) // SHA-256
  })

  it('records the sign-in and updates last_login_at', async () => {
    await signIn(app, member.email)
    const { rows } = await app.pg.query('SELECT last_login_at FROM members WHERE id = $1', [member.id])
    expect(rows[0].last_login_at).not.toBeNull()

    const { rows: audits } = await app.pg.query(
      "SELECT action, outcome FROM audit_log WHERE actor_id = $1 AND action = 'sign_in'",
      [member.id],
    )
    expect(audits).toHaveLength(1)
    expect(audits[0].outcome).toBe('allowed')
  })

  it('sets both cookies for a browser and returns no token in the body', async () => {
    const { response, body } = await signIn(app, member.email)
    const names = response.cookies.map((c) => c.name)
    expect(names).toContain('gwc_at')
    expect(names).toContain('gwc_rt')
    expect(body.accessToken).toBeUndefined()
    expect(body.refreshToken).toBeUndefined()

    const refreshCookie = response.cookies.find((c) => c.name === 'gwc_rt')
    // Narrowest possible exposure for the credential that outlives the session.
    expect(refreshCookie.path).toBe('/auth/refresh')
    expect(String(refreshCookie.sameSite).toLowerCase()).toBe('strict')
    expect(refreshCookie.httpOnly).toBe(true)
  })

  it('carries identity only in `principal` — never permissions or entitlement', async () => {
    const { body } = await signIn(app, member.email, PASSWORD)
    expect(Object.keys(body.principal).sort()).toEqual(['displayName', 'id', 'kind'])
  })
})
