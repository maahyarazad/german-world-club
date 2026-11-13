import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace, expireInThePast, TERMS } from './helpers.ts'
import { createJobHandlers } from '../../src/ops/jobs.ts'
import { SCOPE } from '../../src/db/counters.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Members cannot offer a job (feature 021, US2 and US3).
 *
 * Three layers, each asserted on its own:
 *   * the API refuses a job offer, on create and on an edit into one, with
 *     422 `marketplace/mode-not-allowed`, and stores nothing;
 *   * the `marketplace_no_new_job_offer` trigger refuses the same through
 *     plain SQL, so a path that skipped the application check still cannot;
 *   * job offers that predate the rule wind down normally — edited, filled,
 *     withdrawn, expired, hidden and restored — which is exactly what a CHECK
 *     constraint would have broken (research R4).
 *
 * Every refusal has a counter-assertion: the nearest allowed thing succeeds.
 */

const MODE_NOT_ALLOWED = /\/marketplace\/mode-not-allowed$/

const jobOffer = {
  category: 'job',
  mode: 'offer',
  title: 'Barista wanted',
  body: 'Full time in Dubai Marina, starting next month.',
  details: { employment_type: 'full_time', city: 'Dubai' },
  termsVersion: TERMS,
}

describe.skipIf(!hasDatabase)('no job offers from members', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
  })

  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers: owner.headers, payload })
  const edit = (id: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: `/marketplace/listings/${id}`, headers: owner.headers, payload })
  const listingCount = async () =>
    (await app.pg.query('SELECT count(*)::int AS n FROM marketplace_listings')).rows[0].n as number
  const quotaUsed = async () =>
    (await app.pg.query('SELECT used FROM counters WHERE scope = $1 AND subject = $2',
      [SCOPE.MARKETPLACE_LISTINGS, owner.id])).rows[0]?.used ?? 0
  const row = async (id: string) =>
    (await app.pg.query('SELECT category::text, mode::text, state::text, title FROM marketplace_listings WHERE id = $1', [id])).rows[0]

  // ---- The API (US2) -------------------------------------------------------

  describe('the API', () => {
    it('refuses to create a job offer with its own problem, storing nothing and reserving no quota', async () => {
      const response = await create(jobOffer)

      expect(response.statusCode).toBe(422)
      expect(response.json().type).toMatch(MODE_NOT_ALLOWED)
      expect(await listingCount()).toBe(0)
      expect(await quotaUsed()).toBe(0)
    })

    it('accepts the same member’s job REQUEST — the counter-assertion', async () => {
      const response = await create({ ...jobOffer, mode: 'request', title: 'Looking for barista work' })

      expect(response.statusCode, response.body).toBe(201)
      expect(await listingCount()).toBe(1)
    })

    it('refuses to edit a general OFFER into the job category, leaving it as it was', async () => {
      const id = await seedListing(app.pg, { ownerId: owner.id, category: 'general', mode: 'offer' })
      const response = await edit(id, { category: 'job', details: { employment_type: 'full_time', city: 'Dubai' } })

      expect(response.statusCode).toBe(422)
      expect(response.json().type).toMatch(MODE_NOT_ALLOWED)
      expect(await row(id)).toMatchObject({ category: 'general', mode: 'offer' })
      const { rows } = await app.pg.query('SELECT 1 FROM marketplace_general_details WHERE listing_id = $1', [id])
      expect(rows, 'the general detail row must survive the refused edit').toHaveLength(1)
    })

    it('accepts editing a general REQUEST into the job category — the counter-assertion', async () => {
      const id = await seedListing(app.pg, { ownerId: owner.id, category: 'general', mode: 'request' })
      const response = await edit(id, { category: 'job', details: { employment_type: 'part_time', city: 'Dubai' } })

      expect(response.statusCode, response.body).toBe(200)
      expect(await row(id)).toMatchObject({ category: 'job', mode: 'request' })
    })
  })

  // ---- The database (US2) --------------------------------------------------

  describe('the database trigger', () => {
    const insert = (mode: 'offer' | 'request', state = 'active') =>
      app.pg.query(
        `INSERT INTO marketplace_listings
           (owner_id, category, mode, title, body, state, terms_version, published_at, state_changed_at)
         VALUES ($1, 'job', $2::marketplace_mode, 'Direct insert', 'A body longer than ten characters.',
                 $3::marketplace_state, $4, CASE WHEN $3::text = 'draft' THEN NULL ELSE now() END, now())
         RETURNING id`,
        [owner.id, mode, state, TERMS],
      )

    it('refuses a job offer inserted with plain SQL', async () => {
      await expect(insert('offer')).rejects.toMatchObject({
        code: '23514', constraint: 'marketplace_no_new_job_offer',
      })
    })

    it('refuses turning a job request into an offer', async () => {
      const { rows } = await insert('request')
      await expect(app.pg.query(`UPDATE marketplace_listings SET mode = 'offer' WHERE id = $1`, [rows[0].id]))
        .rejects.toMatchObject({ constraint: 'marketplace_no_new_job_offer' })
    })

    it('refuses publishing a legacy DRAFT job offer', async () => {
      const id = await seedListing(app.pg, { ownerId: owner.id, category: 'job', mode: 'offer', state: 'draft' })
      await app.pg.query('UPDATE marketplace_listings SET published_at = NULL WHERE id = $1', [id])
      await expect(app.pg.query(
        `UPDATE marketplace_listings SET state = 'active', published_at = now() WHERE id = $1`, [id],
      )).rejects.toMatchObject({ constraint: 'marketplace_no_new_job_offer' })
      expect((await row(id)).state).toBe('draft')
    })

    it('accepts a job request inserted with plain SQL — the counter-assertion', async () => {
      const { rows } = await insert('request')
      expect(rows).toHaveLength(1)
    })
  })

  // ---- Legacy job offers wind down (US3) -----------------------------------

  describe('job offers that predate the rule', () => {
    // `seedListing` creates a job offer the way pre-migration rows exist —
    // see its comment in helpers.ts.
    const legacy = (state = 'active') =>
      seedListing(app.pg, { ownerId: owner.id, category: 'job', mode: 'offer', state })

    it('can still be edited by its owner, and stays a job offer', async () => {
      const id = await legacy()
      const response = await edit(id, {
        title: 'Barista wanted — weekends only',
        details: { employment_type: 'part_time', city: 'Dubai' },
      })

      expect(response.statusCode, response.body).toBe(200)
      expect(await row(id)).toMatchObject({ category: 'job', mode: 'offer', title: 'Barista wanted — weekends only' })
    })

    it('can be marked filled, or withdrawn, by its owner', async () => {
      const filled = await legacy()
      const withdrawn = await legacy()
      const setState = (id: string, state: string) =>
        app.inject({ method: 'POST', url: `/marketplace/listings/${id}/state`, headers: owner.headers, payload: { state } })

      expect((await setState(filled, 'filled')).statusCode).toBe(200)
      expect((await setState(withdrawn, 'withdrawn')).statusCode).toBe(200)
      expect((await row(filled)).state).toBe('filled')
      expect((await row(withdrawn)).state).toBe('withdrawn')
    })

    it('is expired by the expiry job', async () => {
      const id = await legacy()
      await expireInThePast(app.pg, id)
      await createJobHandlers(app)['marketplace-expiry']()
      expect((await row(id)).state).toBe('expired')
    })

    it('can be hidden and restored by moderation', async () => {
      const id = await legacy()
      const admin = await createAdmin(app.pg, { grants: { marketplace_moderation: true } })
      const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })

      const hide = await app.inject({
        method: 'POST', url: `/admin/marketplace/listings/${id}/hide`, headers, payload: { reason: 'Check wording' },
      })
      expect(hide.statusCode, hide.body).toBe(200)
      const restore = await app.inject({
        method: 'POST', url: `/admin/marketplace/listings/${id}/restore`, headers, payload: { reason: 'Wording fine' },
      })
      expect(restore.statusCode, restore.body).toBe(200)
      expect((await row(id)).state).toBe('active')
    })

    it('is still listed while active, under job offers', async () => {
      const id = await legacy()
      const response = await app.inject({
        method: 'GET', url: '/marketplace/listings?category=job&mode=offer', headers: owner.headers,
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().items.map((l: { id: string }) => l.id)).toEqual([id])
    })
  })
})
