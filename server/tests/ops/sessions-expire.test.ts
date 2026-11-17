import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { buildAuthApp, resetAuthTables, createMember } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { createJobHandlers } from '../../src/ops/jobs.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The `sessions.expire` job (feature 007; fixed in 024).
 *
 * It revokes every session whose refresh token expired unused, with the reason
 * `expired`. That reason was never in `sessions_revoked_reason_check`, so in
 * production the job failed every 15 minutes on the first such session — a
 * partner session — and never revoked anything. Migration 043 allows it.
 */
describe.skipIf(!hasDatabase)('the sessions.expire job', () => {
  let app: GwcApp

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => { await resetAuthTables(app.pg) })

  /** One session for its own account (one live session per account), with one refresh token. */
  const sessionWithToken = async (accountKind: string, accountId: string, expiresIn: string) => {
    const { rows } = await app.pg.query(
      'INSERT INTO sessions (account_id, account_kind) VALUES ($1, $2) RETURNING id',
      [accountId, accountKind],
    )
    const sessionId = String(rows[0].id)
    await app.pg.query(
      `INSERT INTO refresh_tokens (session_id, token_hash, expires_at) VALUES ($1, $2, now() + $3::interval)`,
      [sessionId, randomBytes(32), expiresIn],
    )
    return sessionId
  }

  const sessionRow = async (id: string) =>
    (await app.pg.query('SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1', [id])).rows[0]

  const run = () => createJobHandlers(app)['sessions.expire']()

  it('revokes a session whose refresh token expired unused, as expired, and succeeds', async () => {
    const stale = await sessionWithToken('member', String((await createMember(app.pg)).id), '-1 day')
    const live = await sessionWithToken('member', String((await createMember(app.pg)).id), '1 day')

    await expect(run()).resolves.toMatchObject({ itemsProcessed: 1 })

    expect(await sessionRow(stale)).toMatchObject({ revoked_reason: 'expired' })
    expect((await sessionRow(stale)).revoked_at).not.toBeNull()
    // Counter-assertion: a live session is untouched.
    expect(await sessionRow(live)).toMatchObject({ revoked_at: null, revoked_reason: null })
  })

  it('revokes an expired partner session too — the row that failed in production', async () => {
    const partner = await sessionWithToken('partner', randomUUID(), '-1 day')

    await expect(run()).resolves.toMatchObject({ itemsProcessed: 1 })
    expect(await sessionRow(partner)).toMatchObject({ revoked_reason: 'expired' })
  })

  it('leaves an already-revoked session as it was', async () => {
    const id = await sessionWithToken('member', String((await createMember(app.pg)).id), '-1 day')
    await app.pg.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1`, [id])

    await expect(run()).resolves.toMatchObject({ itemsProcessed: 0 })
    expect(await sessionRow(id)).toMatchObject({ revoked_reason: 'logout' })
  })
})
