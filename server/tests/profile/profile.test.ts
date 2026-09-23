import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, createMember, resetAuthTables, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Member profiles (feature 009): your own, with your contact details, and
 * everybody else's, without them.
 */
describe.skipIf(!hasDatabase)('member profiles', () => {
  let app: GwcApp
  let me: { id: string; headers: Record<string, string> }
  let other: { id: string; headers: Record<string, string> }

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  const memberWithBearer = async () => {
    const row = await createMember(app.pg, { mobile: '+4917012345678' })
    await app.pg.query(`UPDATE members SET birthday = '1985-06-01', bio = 'Hello', city = 'Dubai' WHERE id = $1`, [row.id])
    return { id: String(row.id), headers: await bearerFor(app, { accountId: String(row.id), accountKind: 'member' }) }
  }

  beforeEach(async () => {
    await resetAuthTables(app.pg)
    me = await memberWithBearer()
    other = await memberWithBearer()
  })

  const patch = (payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/profile/me', headers: me.headers, payload })

  it('shows you your own contact details', async () => {
    const profile = (await app.inject({ method: 'GET', url: '/profile/me', headers: me.headers })).json()
    expect(profile).toMatchObject({ id: me.id, mobile: '+4917012345678', birthday: '1985-06-01', bio: 'Hello' })
    expect(profile.email).toContain('@test.invalid')
  })

  it('shows another member without email, mobile or birthday', async () => {
    const response = await app.inject({ method: 'GET', url: `/profile/members/${other.id}`, headers: me.headers })
    expect(response.statusCode).toBe(200)
    const body = JSON.stringify(response.json())
    expect(body).not.toContain('@test.invalid')
    expect(body).not.toContain('4917012345678')
    expect(body).not.toContain('1985')
    // The counter-assertion: the profile is not simply empty.
    expect(response.json()).toMatchObject({ id: other.id, bio: 'Hello', city: 'Dubai', isSelf: false })
  })

  it('edits only what is sent: absent is untouched, null clears', async () => {
    const edited = (await patch({ city: 'Berlin' })).json()
    expect(edited).toMatchObject({ city: 'Berlin', bio: 'Hello' })
    const cleared = (await patch({ bio: null })).json()
    expect(cleared).toMatchObject({ city: 'Berlin', bio: null })
  })

  it('does not let a member rename themselves — §3.2 routes that through staff', async () => {
    const before = (await app.inject({ method: 'GET', url: '/profile/me', headers: me.headers })).json()
    await patch({ displayName: 'Somebody Else', email: 'x@y.invalid', city: 'Munich' })
    const after = (await app.inject({ method: 'GET', url: '/profile/me', headers: me.headers })).json()
    expect(after).toMatchObject({ displayName: before.displayName, email: before.email, city: 'Munich' })
  })

  it('answers a locked member exactly like one who never existed', async () => {
    await app.pg.query(`UPDATE members SET status = 'locked' WHERE id = $1`, [other.id])
    const locked = await app.inject({ method: 'GET', url: `/profile/members/${other.id}`, headers: me.headers })
    const absent = await app.inject({ method: 'GET', url: '/profile/members/00000000-0000-0000-0000-000000000000', headers: me.headers })
    // instance and requestId differ per request by construction and carry no
    // account information; everything else must match.
    const strip = (r: typeof locked) => [r.statusCode, { ...r.json(), instance: null, requestId: null }]
    expect(strip(locked)).toEqual(strip(absent))
  })

  it('counts followers on both sides', async () => {
    await app.inject({ method: 'PUT', url: `/threads/follows/${other.id}`, headers: me.headers })
    const theirs = (await app.inject({ method: 'GET', url: `/profile/members/${other.id}`, headers: me.headers })).json()
    const mine = (await app.inject({ method: 'GET', url: '/profile/me', headers: me.headers })).json()
    expect(theirs).toMatchObject({ followers: 1, isFollowing: true })
    expect(mine.following).toBe(1)
  })
})
