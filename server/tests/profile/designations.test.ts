import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, staff, post, get } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from '../threads/social-helpers.ts'

/** US6: staff grant and revoke the influencer designation (FR-017). */
describe.skipIf(!hasDatabase)('influencer designation (US6)', () => {
  let app: GwcApp
  let anna: Member
  let admin: { id: string; headers: Record<string, string> }

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna')
    admin = await staff(app, { members: { read: true, write: true } })
  })

  const url = () => `/admin/members/${anna.id}/designations/influencer`
  const grant = (reason = 'Brand ambassador') => app.inject({ method: 'POST', url: url(), headers: admin.headers, payload: { reason } })
  const revoke = (reason = 'Contract ended') => app.inject({ method: 'DELETE', url: url(), headers: admin.headers, payload: { reason } })
  const isInfluencer = async () => (await get(app, anna, '/profile/me')).json().isInfluencer

  it('grants with a reason, shows the badge everywhere, and audits it', async () => {
    expect(await isInfluencer()).toBe(false)
    const response = await grant()
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toEqual([expect.objectContaining({ designation: 'influencer', grantReason: 'Brand ambassador', revokedAt: null })])
    expect(await isInfluencer()).toBe(true)
    expect((await post(app, anna, { body: 'Hi' })).json().author.isInfluencer).toBe(true)
    const { rows } = await app.pg.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'member.designation.granted' AND target_id = $1`, [anna.id])
    expect(rows[0].n).toBe(1)
  })

  it('refuses a grant without a reason, and a second grant is a no-op', async () => {
    expect((await grant('')).statusCode).toBe(400)
    await grant()
    const again = await grant('Again')
    expect(again.json().items).toHaveLength(1)
    const { rows } = await app.pg.query(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'member.designation.granted'`)
    expect(rows[0].n).toBe(1)
  })

  it('revokes into history and a later grant is a new row', async () => {
    expect((await revoke()).statusCode).toBe(404)
    await grant()
    const revoked = (await revoke()).json().items
    expect(revoked[0]).toMatchObject({ revokeReason: 'Contract ended' })
    expect(revoked[0].revokedAt).not.toBeNull()
    expect(await isInfluencer()).toBe(false)
    expect((await grant('Back again')).json().items).toHaveLength(2)
  })

  it('lets staff find a member by handle, without contact details', async () => {
    const found = await app.inject({ method: 'GET', url: `/admin/members/by-handle/@${anna.handle}`, headers: admin.headers })
    expect(found.json()).toEqual({ id: anna.id, displayName: 'Anna', handle: anna.handle, status: 'active' })
    expect(found.body).not.toContain(anna.email)
    expect((await app.inject({ method: 'GET', url: '/admin/members/by-handle/nobody.here', headers: admin.headers })).statusCode).toBe(404)
  })

  it('refuses deleting history, even by hand', async () => {
    await grant()
    await expect(app.pg.query('DELETE FROM member_designations WHERE member_id = $1', [anna.id])).rejects.toThrow(/never deleted/)
  })

  it('needs members.write to grant; a member token is the wrong audience', async () => {
    const reader = await staff(app, { members: { read: true } })
    expect((await app.inject({ method: 'POST', url: url(), headers: reader.headers, payload: { reason: 'Try' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: `/admin/members/${anna.id}/designations`, headers: reader.headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'POST', url: url(), headers: anna.headers, payload: { reason: 'Me' } })).statusCode).toBe(403)
  })
})
