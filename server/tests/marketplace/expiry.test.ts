import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace, expireInThePast } from './helpers.ts'
import { createJobHandlers } from '../../src/ops/jobs.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Optional expiry (US3, FR-028, FR-029, FR-030, SC-012).
 *
 * `expires_at` NULL means unlimited — a first-class choice, not a missing
 * value. The job's predicate names both halves: `expires_at IS NOT NULL AND
 * expires_at <= now()`. Every test in the "the job" block runs the SAME
 * predicate against a corpus that spans all three cases, because a job whose
 * WHERE clause forgot the null check would pass any suite that only ever
 * seeded listings with an expiry.
 */

describe.skipIf(!hasDatabase)('optional expiry', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
  })

  const patchExpiry = (id: string, expiresAt: string | null) =>
    app.inject({
      method: 'PATCH', url: `/marketplace/listings/${id}`, headers: owner.headers,
      payload: { expiresAt },
    })

  describe('a member setting their own expiry', () => {
    it('accepts a future date and stays active', async () => {
      const listing = await seedListing(app.pg, { ownerId: owner.id })
      const future = new Date(Date.now() + 86_400_000).toISOString()

      const response = await patchExpiry(listing, future)
      expect(response.statusCode).toBe(200)
      expect(new Date(response.json().expiresAt).toISOString()).toBe(future)
    })

    it('clears an expiry back to unlimited by sending null', async () => {
      const listing = await seedListing(app.pg, {
        ownerId: owner.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })

      const response = await patchExpiry(listing, null)
      expect(response.statusCode).toBe(200)
      expect(response.json().expiresAt).toBeNull()
    })

    it('leaves the expiry untouched when the field is not sent at all', async () => {
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString()
      const listing = await seedListing(app.pg, { ownerId: owner.id, expiresAt })

      const response = await app.inject({
        method: 'PATCH', url: `/marketplace/listings/${listing}`, headers: owner.headers,
        payload: { title: 'Only the title changes' },
      })
      expect(new Date(response.json().expiresAt).toISOString()).toBe(expiresAt)
    })

    it('refuses another member setting it', async () => {
      const stranger = await poster(app)
      const listing = await seedListing(app.pg, { ownerId: owner.id })
      const response = await app.inject({
        method: 'PATCH', url: `/marketplace/listings/${listing}`, headers: stranger.headers,
        payload: { expiresAt: null },
      })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('the expiry job', () => {
    const run = () => createJobHandlers(app)['marketplace-expiry']()

    const stateOf = async (id: string) => {
      const { rows } = await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [id])
      return rows[0].state
    }

    it('expires a listing whose date is in the PAST', async () => {
      // Seeded with no expiry, then pushed into the past directly: the
      // `listings_expiry_after_publication` CHECK requires expires_at >
      // published_at, and seedListing publishes at now() — an expiry earlier
      // than "now" is also earlier than publication and the row is refused.
      const listing = await seedListing(app.pg, { ownerId: owner.id })
      await expireInThePast(app.pg, listing)

      await run()
      expect(await stateOf(listing)).toBe('expired')
    })

    it('leaves a listing whose date is in the FUTURE alone', async () => {
      const future = new Date(Date.now() + 86_400_000).toISOString()
      const listing = await seedListing(app.pg, { ownerId: owner.id, expiresAt: future })

      await run()
      expect(await stateOf(listing)).toBe('active')
    })

    it('leaves an UNLIMITED listing (NULL expiry) alone — the headline negative case (SC-012)', async () => {
      const listing = await seedListing(app.pg, { ownerId: owner.id, expiresAt: null })

      await run()
      // Without this assertion, a job whose WHERE clause dropped the
      // `IS NOT NULL` check would pass the two tests above and quietly expire
      // every unlimited listing in production.
      expect(await stateOf(listing)).toBe('active')
    })

    it('does all three correctly in the SAME run, over one mixed corpus', async () => {
      const expired = await seedListing(app.pg, { ownerId: owner.id })
      await expireInThePast(app.pg, expired)
      const future = await seedListing(app.pg, {
        ownerId: owner.id, expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      })
      const unlimited = await seedListing(app.pg, { ownerId: owner.id, expiresAt: null })

      const result = await run()
      expect(result.itemsProcessed).toBe(1)

      expect(await stateOf(expired)).toBe('expired')
      expect(await stateOf(future)).toBe('active')
      expect(await stateOf(unlimited)).toBe('active')
    })

    it('never touches a listing that is not active — no re-expiring a withdrawn one', async () => {
      const withdrawn = await seedListing(app.pg, { ownerId: owner.id, state: 'withdrawn' })
      await expireInThePast(app.pg, withdrawn)

      await run()
      // state_changed_at should not have been touched by the job either — the
      // job's WHERE clause requires state = 'active'.
      expect(await stateOf(withdrawn)).toBe('withdrawn')
    })

    it('is registered as an individually enableable job', async () => {
      const { rows } = await app.pg.query(
        `SELECT enabled FROM job_definitions WHERE name = 'marketplace-expiry'`,
      )
      expect(rows).toHaveLength(1)
    })
  })
})
