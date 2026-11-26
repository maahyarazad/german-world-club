import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { patchListing, poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Editing your own listing (feature 037, US1, FR-001..FR-004).
 *
 * The state decides whether an edit is allowed: draft, active and expired yes;
 * sold, filled, withdrawn and hidden no. Every refusal must leave the stored
 * row exactly as it was — a 409 that still wrote would pass a status-only test.
 * And editing needs no permission: `poster()` carries no flags at all.
 */

describe.skipIf(!hasDatabase)('editing your own listing', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
  })

  const titleOf = async (id: string) =>
    String((await app.pg.query('SELECT title FROM marketplace_listings WHERE id = $1', [id])).rows[0].title)

  describe.each(['draft', 'active', 'expired'])('a %s listing', (state) => {
    it('can be edited by a plain member, and the change is stored', async () => {
      const id = await seedListing(app.pg, { ownerId: owner.id, state })
      const response = await patchListing(app, owner.headers, id, { title: 'A corrected title' })
      expect(response.statusCode).toBe(200)
      expect(response.json().title).toBe('A corrected title')
      expect(await titleOf(id)).toBe('A corrected title')
    })
  })

  describe.each(['sold', 'filled', 'withdrawn', 'hidden'])('a %s listing', (state) => {
    it('answers 409 not-editable and writes nothing', async () => {
      const id = await seedListing(app.pg, { ownerId: owner.id, state, title: 'The original title' })
      const response = await patchListing(app, owner.headers, id, { title: 'Should not be stored' })
      expect(response.statusCode).toBe(409)
      expect(response.json().type).toMatch(/marketplace\/not-editable$/)
      // The counter-assertion: the row is untouched.
      expect(await titleOf(id)).toBe('The original title')
    })
  })

  it('refuses a stranger with the same 404 as an unknown id, never the 409', async () => {
    // A stranger must not learn the state of a listing that is not theirs: a
    // sold listing answers 404 to them, not "not editable".
    const stranger = await poster(app)
    const sold = await seedListing(app.pg, { ownerId: owner.id, state: 'sold' })
    const refused = await patchListing(app, stranger.headers, sold, { title: 'Hijacked title' })
    const unknown = await patchListing(app, stranger.headers, '00000000-0000-4000-8000-000000000000', { title: 'Hijacked title' })
    expect(refused.statusCode).toBe(404)
    expect(refused.json()).toEqual({ ...unknown.json(), instance: refused.json().instance })
  })

  it('refuses a change into a mode the category does not allow, leaving the listing as it was', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, category: 'general', mode: 'offer' })
    const response = await patchListing(app, owner.headers, id, { category: 'job', details: { employment_type: 'full_time', city: 'Dubai' } })
    expect(response.statusCode).toBe(422)
    const { rows } = await app.pg.query('SELECT category FROM marketplace_listings WHERE id = $1', [id])
    expect(rows[0].category).toBe('general')
  })

  it('lets the owner change expiry and clear it back to unlimited', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString()
    const set = await patchListing(app, owner.headers, id, { expiresAt: future })
    expect(new Date(set.json().expiresAt).toISOString()).toBe(future)
    const cleared = await patchListing(app, owner.headers, id, { expiresAt: null })
    expect(cleared.json().expiresAt).toBeNull()
  })

  it('refuses an invalid expiry date with a named field', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    const response = await patchListing(app, owner.headers, id, { expiresAt: 'not a date' })
    expect(response.statusCode).toBe(400)
    expect(response.json().detail).toMatch(/expiresAt/)
  })
})
