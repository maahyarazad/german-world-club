import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { hasDatabase } from '../helpers/db.ts'
import { buildSocialApp, resetSocial, member, get } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'
import type { Member } from '../threads/social-helpers.ts'

/**
 * Handles (feature 010, FR-011): format, reserved words, uniqueness without
 * regard to case, and the 30-day change rule.
 */
describe.skipIf(!hasDatabase)('handles (FR-011)', () => {
  let app: GwcApp
  let anna: Member
  let ben: Member

  beforeAll(async () => { app = await buildSocialApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetSocial(app)
    anna = await member(app, 'Anna', { handle: null })
    ben = await member(app, 'Ben', { handle: 'ben.berlin' })
  })

  const setHandle = (who: Member, handle: string) =>
    app.inject({ method: 'PUT', url: '/profile/me/handle', headers: who.headers, payload: { handle } })

  it('stores a valid first handle, lowercased, and returns it on the profile', async () => {
    const response = await setHandle(anna, '@Anna_Dubai')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ handle: 'anna_dubai' })
    // Counter-assertion: it is really stored, not just echoed.
    expect((await get(app, anna, '/profile/me')).json().handle).toBe('anna_dubai')
  })

  it.each(['ab', '.anna', 'anna.', 'an na', 'x'.repeat(31), 'anna!'])('refuses the malformed handle %j, naming the field', async (bad) => {
    const response = await setHandle(anna, bad)
    expect(response.statusCode).toBe(400)
    expect(response.json().errors).toEqual([expect.objectContaining({ path: 'handle' })])
  })

  it('refuses a reserved handle exactly like a taken one', async () => {
    const reserved = await setHandle(anna, 'admin')
    const taken = await setHandle(anna, 'BEN.berlin')
    expect(reserved.statusCode).toBe(400)
    expect(taken.statusCode).toBe(400)
    expect(reserved.json().errors).toEqual(taken.json().errors)
  })

  it('answers availability the same for taken and reserved, and true for your own', async () => {
    const available = (h: string, who = anna) => get(app, who, `/profile/handles/${h}/available`).then((r) => r.json().available)
    expect(await available('ben.berlin')).toBe(false)
    expect(await available('admin')).toBe(false)
    expect(await available('free.handle')).toBe(true)
    expect(await available('ben.berlin', ben)).toBe(true)
  })

  it('allows one change every 30 days, and says when the next one is allowed', async () => {
    expect((await setHandle(anna, 'anna.one')).statusCode).toBe(200)
    // The first choice starts the clock too.
    const profile = (await get(app, anna, '/profile/me')).json()
    expect(profile.handleChangeableAt).not.toBeNull()

    const again = await setHandle(anna, 'anna.two')
    expect(again.statusCode).toBe(409)
    expect(again.json().type).toMatch(/handle-change-too-soon$/)

    // Re-saving the same handle is not a change.
    expect((await setHandle(anna, 'anna.one')).statusCode).toBe(200)

    await app.pg.query(`UPDATE members SET handle_changed_at = now() - interval '31 days' WHERE id = $1`, [anna.id])
    expect((await setHandle(anna, 'anna.two')).statusCode).toBe(200)
  })

  it('never releases a handle when a membership ends', async () => {
    await app.pg.query(`UPDATE members SET status = 'ended' WHERE id = $1`, [ben.id])
    expect((await setHandle(anna, 'ben.berlin')).statusCode).toBe(400)
  })

  it('is enforced by the database for an ad-hoc write as well', async () => {
    await expect(app.pg.query(`UPDATE members SET handle = 'Has Space' WHERE id = $1`, [anna.id]))
      .rejects.toThrow(/members_handle_format/)
  })
})
