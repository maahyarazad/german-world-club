import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { PROBLEMS } from '@gwc/contracts/errors'
import { buildAuthApp, createMember, resetAuthTables, signIn, bearerFor, PASSWORD } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { generateOpaqueToken } from '../../src/modules/auth/tokens.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Feature 043, a characterisation test: what the EMAILED-LINK password reset does
 * today, written down before its logic is moved into a shared module.
 *
 * The app's SMS-code reset (feature 043) and the website's emailed link end in the
 * same act, "this account has a new password and every session is over", and that
 * act now lives in one place (`finish-password-reset.ts`) so the two cannot drift.
 * Moving working code is the moment it changes by accident, so this file passes
 * BEFORE the move and must pass identically AFTER it. It deliberately restates a few
 * things `console-sign-in.test.ts` already checks (single use, the new password), so
 * that this file alone is the whole contract of the link flow.
 *
 * A fresh app per test, as in console-sign-in.test.ts: the confirm route is rate
 * limited per address and the limiter counts across an instance.
 */
const NEW_PASSWORD = 'ein-ganz-neues-passwort'

describe.skipIf(!hasDatabase)('the emailed-link password reset (unchanged by feature 043)', () => {
  let app: GwcApp

  beforeEach(async () => {
    app = await buildAuthApp()
    await resetAuthTables(app.pg)
  })
  afterEach(async () => { await app.close() })

  // The mail is queued, so the plaintext token is never readable from the database
  // (only its hash is stored). Insert a token of our own, the way the request route does.
  const mintToken = async (accountId: string, { expiresInSeconds = 3600 } = {}) => {
    const token = generateOpaqueToken()
    await app.pg.query(
      `INSERT INTO password_reset_tokens (account_id, account_kind, token_hash, expires_at)
       VALUES ($1, 'member', $2, now() + make_interval(secs => $3))`,
      [accountId, token.hash, expiresInSeconds],
    )
    return token.plaintext
  }

  const confirm = (token: string, password = NEW_PASSWORD) =>
    app.inject({ method: 'POST', url: '/auth/password-reset/confirm', payload: { token, password } })

  const me = (authorization: string) => app.inject({ method: 'GET', url: '/auth/me', headers: { authorization } })

  it('changes the password once: the new one signs in, the old one does not', async () => {
    const member = await createMember(app.pg)
    const token = await mintToken(member.id)

    const done = await confirm(token)
    expect(done.statusCode).toBe(200)
    expect(done.json()).toEqual({ reset: true })

    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
    // Counter-assertion: without it this passes against a reset that set nothing.
    expect((await signIn(app, member.email, PASSWORD)).statusCode).toBe(401)
  })

  it('refuses the same token a second time, and an expired one, as an invalid link', async () => {
    const member = await createMember(app.pg)
    const token = await mintToken(member.id)
    expect((await confirm(token)).statusCode).toBe(200)

    const replay = await confirm(token, 'zweites-neues-passwort')
    expect(replay.statusCode).toBe(401)
    expect(replay.json().type).toBe(PROBLEMS.INVALID_RESET_TOKEN.type)

    const expired = await confirm(await mintToken(member.id, { expiresInSeconds: -60 }), 'drittes-neues-passwort')
    expect(expired.statusCode).toBe(401)
    expect(expired.json().type).toBe(PROBLEMS.INVALID_RESET_TOKEN.type)

    // Neither refusal changed the password: the first reset's is still the one.
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).toBe('authenticated')
  })

  it('clears password_reset_required', async () => {
    const member = await createMember(app.pg, { passwordResetRequired: true })
    expect((await confirm(await mintToken(member.id))).statusCode).toBe(200)
    const { rows } = await app.pg.query('SELECT password_reset_required AS flag FROM members WHERE id = $1', [member.id])
    expect(rows[0].flag).toBe(false)
  })

  it('reactivates an inactive member (section 3.2)', async () => {
    const member = await createMember(app.pg, { status: 'inactive' })
    expect((await confirm(await mintToken(member.id))).statusCode).toBe(200)
    const { rows } = await app.pg.query('SELECT status FROM members WHERE id = $1', [member.id])
    expect(rows[0].status).toBe('active')
  })

  it('ends every session the member had, audits it, and takes their tokens away', async () => {
    const member = await createMember(app.pg)
    const { authorization, sessionId } = await bearerFor(app, { accountId: member.id, accountKind: 'member' })
    expect((await me(authorization)).statusCode, 'the session works before the reset').toBe(200)

    expect((await confirm(await mintToken(member.id))).statusCode).toBe(200)

    // The token that was valid a moment ago is refused now: on the very next request.
    expect((await me(authorization)).statusCode).toBe(401)
    const session = await app.pg.query('SELECT revoked_at, revoked_reason FROM sessions WHERE id = $1', [sessionId])
    expect(session.rows[0].revoked_at).not.toBeNull()
    expect(session.rows[0].revoked_reason).toBe('password_reset')
    const refresh = await app.pg.query('SELECT count(*)::int AS n FROM refresh_tokens WHERE session_id = $1', [sessionId])
    expect(refresh.rows[0].n).toBe(0)

    const audit = await app.pg.query(
      `SELECT detail FROM audit_log WHERE action = 'session_revoked' AND actor_id = $1`, [member.id],
    )
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].detail).toMatchObject({ reason: 'password_reset', count: 1 })
  })

  // A locked member can still have a link in their mailbox. The link changes the
  // password and nothing else: unlocking is staff's decision, never a side effect.
  it('changes a locked member\'s password but leaves them locked', async () => {
    const member = await createMember(app.pg, { status: 'locked' })
    const before = await app.pg.query('SELECT password_hash FROM members WHERE id = $1', [member.id])

    expect((await confirm(await mintToken(member.id))).statusCode).toBe(200)

    const after = await app.pg.query('SELECT password_hash, status FROM members WHERE id = $1', [member.id])
    expect(after.rows[0].password_hash).not.toBe(before.rows[0].password_hash)
    expect(after.rows[0].status).toBe('locked')
    // And they still cannot sign in, with the new password or the old.
    expect((await signIn(app, member.email, NEW_PASSWORD)).body.outcome).not.toBe('authenticated')
  })
})
