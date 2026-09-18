import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, createAdmin, resetAuthTables, signIn } from '../helpers/auth.js'
import { hasDatabase } from '../helpers/db.js'

/**
 * FR-010 / §3.2 — the status gates, and the rule that binds them:
 * **no token is issued in any of these cases.**
 *
 * That is the assertion worth having. A gate that refuses the *response* while
 * still minting a session leaves a usable credential behind, and the member who
 * was just locked can keep working from a client that already holds one.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

describe.skipIf(!hasDatabase)('status gates issue no token (FR-010)', () => {
  beforeEach(async () => { await resetAuthTables(app.pg) })

  const noSessionFor = async (id) => {
    const { rows } = await app.pg.query('SELECT id FROM sessions WHERE account_id = $1', [id])
    return rows.length === 0
  }

  it('refuses a LOCKED member and points at support (§3.2)', async () => {
    const member = await createMember(app.pg, { status: 'locked' })
    const { statusCode, body } = await signIn(app, member.email)
    expect(statusCode).toBe(403)
    expect(body.type).toMatch(/account-locked/)
    expect(body.detail).toMatch(/support/i)
    expect(await noSessionFor(member.id)).toBe(true)
  })

  it('refuses an INACTIVE member and names the reset remedy', async () => {
    const member = await createMember(app.pg, { status: 'inactive' })
    const { statusCode, body } = await signIn(app, member.email)
    expect(statusCode).toBe(403)
    expect(body.type).toMatch(/account-inactive/)
    expect(body.detail).toMatch(/reset/i)
    expect(await noSessionFor(member.id)).toBe(true)
  })

  it('refuses an ENDED membership, with no remedy to offer', async () => {
    const member = await createMember(app.pg, { status: 'ended' })
    const { statusCode, body } = await signIn(app, member.email)
    expect(statusCode).toBe(403)
    expect(body.type).toMatch(/membership-ended/)
    expect(await noSessionFor(member.id)).toBe(true)
  })

  it('routes an unconfirmed address to profile completion, issuing nothing (FR-011)', async () => {
    const member = await createMember(app.pg, { emailConfirmed: false })
    const { statusCode, body } = await signIn(app, member.email)
    expect(statusCode).toBe(200)
    expect(body.outcome).toBe('profile_incomplete')
    expect(body.accessToken).toBeUndefined()
    expect(await noSessionFor(member.id)).toBe(true)
  })

  it('routes a legacy account to a reset, never verifying its hash (FR-014)', async () => {
    const member = await createMember(app.pg, { passwordHash: '5f4dcc3b5aa765d61d8327deb882cf99' })
    const { statusCode, body } = await signIn(app, member.email, 'password')
    expect(statusCode).toBe(200)
    expect(body.outcome).toBe('password_reset_required')
    expect(await noSessionFor(member.id)).toBe(true)
  })

  it('refuses an inactive staff account', async () => {
    const admin = await createAdmin(app.pg, { isActive: false })
    const { statusCode, body } = await signIn(app, admin.email)
    expect(statusCode).toBe(403)
    expect(body.type).toMatch(/account-inactive/)
  })

  it('admits an active, confirmed member', async () => {
    const member = await createMember(app.pg)
    const { statusCode, body } = await signIn(app, member.email)
    expect(statusCode).toBe(200)
    expect(body.outcome).toBe('authenticated')
  })

  it('applies the same gates on the NEXT request, not only at sign-in', async () => {
    const member = await createMember(app.pg)
    const signedIn = await signIn(app, member.email)
    const cookie = signedIn.response.cookies.find((c) => c.name === 'gwc_at')

    const before = await app.inject({ method: 'GET', url: '/auth/me', cookies: { gwc_at: cookie.value } })
    expect(before.statusCode).toBe(200)

    // Staff lock the account while the member is holding a live token.
    await app.pg.query("UPDATE members SET status = 'locked' WHERE id = $1", [member.id])

    const after = await app.inject({ method: 'GET', url: '/auth/me', cookies: { gwc_at: cookie.value } })
    expect(after.statusCode).toBe(403)
    expect(after.json().type).toMatch(/account-locked/)
  })

  it('treats `ended` as terminal at the database level (§3.2)', async () => {
    const member = await createMember(app.pg, { status: 'ended' })
    await expect(
      app.pg.query("UPDATE members SET status = 'active' WHERE id = $1", [member.id]),
    ).rejects.toThrow(/terminal/i)
  })

  it('refuses to delete a member outright (§12.4)', async () => {
    const member = await createMember(app.pg)
    await expect(app.pg.query('DELETE FROM members WHERE id = $1', [member.id]))
      .rejects.toThrow(/never deleted/i)
  })
})
