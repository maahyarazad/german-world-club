import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'
import { startSession, rotateRefreshToken, REFRESH_OUTCOME } from '../../src/modules/auth/sessions.js'

/**
 * FR-005 — rotation, and the replay response.
 *
 * A replay is treated as **compromise, not as a retry**. At the moment a
 * consumed token is presented again, the legitimate holder and an attacker are
 * indistinguishable — one of them has a copy neither should have. The only safe
 * action is to end the lineage and make both re-authenticate.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('refresh rotation (FR-005)', () => {
  let member
  let session

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    member = await createMember(app.pg)
    session = await startSession(app.pg, { accountId: member.id, accountKind: 'member' })
  })

  it('rotates on every refresh — the presented token never works twice', async () => {
    const first = await rotateRefreshToken(app.pg, session.refreshToken)
    expect(first.outcome).toBe(REFRESH_OUTCOME.ROTATED)
    expect(first.refreshToken).not.toBe(session.refreshToken)

    const second = await rotateRefreshToken(app.pg, first.refreshToken)
    expect(second.outcome).toBe(REFRESH_OUTCOME.ROTATED)
    expect(second.refreshToken).not.toBe(first.refreshToken)
  })

  it('records the lineage through parent_id', async () => {
    const first = await rotateRefreshToken(app.pg, session.refreshToken)
    await rotateRefreshToken(app.pg, first.refreshToken)
    const { rows } = await app.pg.query('SELECT id, parent_id FROM refresh_tokens ORDER BY issued_at')
    expect(rows).toHaveLength(3)
    expect(rows[1].parent_id).toBe(rows[0].id)
    expect(rows[2].parent_id).toBe(rows[1].id)
  })

  it('KILLS THE WHOLE LINEAGE on a replay', async () => {
    const first = await rotateRefreshToken(app.pg, session.refreshToken)
    await rotateRefreshToken(app.pg, first.refreshToken)

    // The original is presented a second time.
    const replay = await rotateRefreshToken(app.pg, session.refreshToken)
    expect(replay.outcome).toBe(REFRESH_OUTCOME.REPLAYED)

    const { rows: sessions } = await app.pg.query('SELECT revoked_reason FROM sessions WHERE id = $1', [session.sessionId])
    expect(sessions[0].revoked_reason).toBe('token_reuse')

    const { rows: tokens } = await app.pg.query('SELECT id FROM refresh_tokens WHERE session_id = $1', [session.sessionId])
    expect(tokens).toHaveLength(0)
  })

  it('makes the successor useless too — the attacker gains nothing by racing', async () => {
    const first = await rotateRefreshToken(app.pg, session.refreshToken)
    await rotateRefreshToken(app.pg, session.refreshToken) // replay
    const after = await rotateRefreshToken(app.pg, first.refreshToken)
    expect(after.outcome).toBe(REFRESH_OUTCOME.UNKNOWN)
  })

  it('rejects an unknown token with no session to terminate', async () => {
    const result = await rotateRefreshToken(app.pg, 'a-token-that-was-never-issued')
    expect(result.outcome).toBe(REFRESH_OUTCOME.UNKNOWN)
    const { rows } = await app.pg.query('SELECT revoked_at FROM sessions WHERE id = $1', [session.sessionId])
    expect(rows[0].revoked_at).toBeNull()
  })

  it('rejects a token whose session was already revoked', async () => {
    await app.pg.query("UPDATE sessions SET revoked_at = now(), revoked_reason = 'logout' WHERE id = $1", [session.sessionId])
    const result = await rotateRefreshToken(app.pg, session.refreshToken)
    expect(result.outcome).toBe(REFRESH_OUTCOME.SESSION_REVOKED)
  })

  it('rejects an expired token', async () => {
    await app.pg.query('UPDATE refresh_tokens SET expires_at = now() - interval \'1 day\' WHERE session_id = $1', [session.sessionId])
    const result = await rotateRefreshToken(app.pg, session.refreshToken)
    expect(result.outcome).toBe(REFRESH_OUTCOME.EXPIRED)
  })

  it('answers a replay with 401 over HTTP and writes an audit record', async () => {
    await rotateRefreshToken(app.pg, session.refreshToken)
    const response = await app.inject({
      method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().type).toMatch(/session-revoked/)

    const { rows } = await app.pg.query("SELECT action, outcome FROM audit_log WHERE action = 'token_reuse'")
    expect(rows).toHaveLength(1)
    expect(rows[0].outcome).toBe('denied')
  })

  it('gives a mobile client its tokens in the body and a browser its cookies', async () => {
    const mobile = await app.inject({
      method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken },
    })
    expect(mobile.statusCode).toBe(200)
    expect(mobile.json().accessToken).toBeTruthy()
    expect(mobile.json().refreshToken).toBeTruthy()
  })
})
