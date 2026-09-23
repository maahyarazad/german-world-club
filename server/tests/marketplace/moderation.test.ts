import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables, createAdmin, bearerFor } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Staff moderation (US4, contracts/moderation-api.md).
 *
 * Gated on the EXISTING `marketplace_moderation` module — this feature adds no
 * permission. Every action writes to the append-only audit log with actor,
 * target and reason (FR-018, SC-007), and a hide or remove with no reason is
 * refused before it happens.
 */

describe.skipIf(!hasDatabase)('staff moderation', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let listingId: string

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  const staffWith = async (flags: Partial<Record<'read' | 'write' | 'edit' | 'delete' | 'status', boolean>> | true) => {
    const admin = await createAdmin(app.pg, { grants: { marketplace_moderation: flags } })
    const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
    return { id: admin.id, headers }
  }

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    listingId = await seedListing(app.pg, { ownerId: owner.id })
  })

  const hide = (headers: Record<string, string>, id: string, reason?: string) =>
    app.inject({
      method: 'POST', url: `/admin/marketplace/listings/${id}/hide`, headers,
      payload: reason === undefined ? {} : { reason },
    })

  const restore = (headers: Record<string, string>, id: string, reason = 'Appeal upheld') =>
    app.inject({
      method: 'POST', url: `/admin/marketplace/listings/${id}/restore`, headers, payload: { reason },
    })

  const remove = (headers: Record<string, string>, id: string, reason = 'Prohibited item') =>
    app.inject({
      method: 'DELETE', url: `/admin/marketplace/listings/${id}`, headers, payload: { reason },
    })

  describe('the flag split', () => {
    it("'status' CAN hide a listing", async () => {
      const staff = await staffWith({ status: true })
      const response = await hide(staff.headers, listingId, 'Prohibited category')
      expect(response.statusCode).toBe(200)
      expect(response.json().state).toBe('hidden')
    })

    it("'read' ALONE cannot", async () => {
      const staff = await staffWith({ read: true })
      const response = await hide(staff.headers, listingId, 'Prohibited category')
      expect(response.statusCode).toBe(403)

      // And nothing happened.
      const { rows } = await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [listingId])
      expect(rows[0].state).toBe('active')
    })

    it("'read' CAN see the queue and a listing", async () => {
      const staff = await staffWith({ read: true })
      expect((await app.inject({ method: 'GET', url: '/admin/marketplace/reports', headers: staff.headers })).statusCode).toBe(200)
      expect((await app.inject({ method: 'GET', url: `/admin/marketplace/listings/${listingId}`, headers: staff.headers })).statusCode).toBe(200)
    })

    it("'delete' is required to remove, and is distinct from 'status'", async () => {
      const statusOnly = await staffWith({ status: true })
      expect((await remove(statusOnly.headers, listingId)).statusCode).toBe(403)

      const withDelete = await staffWith({ delete: true })
      expect((await remove(withDelete.headers, listingId)).statusCode).toBe(200)
    })

    it("no staff member without ANY marketplace_moderation grant gets past the module gate", async () => {
      const admin = await createAdmin(app.pg)
      const headers = await bearerFor(app, { accountId: admin.id, accountKind: 'admin' })
      expect((await hide(headers, listingId, 'x')).statusCode).toBe(403)
    })
  })

  describe('a hide requires a reason', () => {
    it('refuses a hide with no reason', async () => {
      const staff = await staffWith({ status: true })
      const response = await hide(staff.headers, listingId)
      expect(response.statusCode).toBe(400)

      const { rows } = await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [listingId])
      expect(rows[0].state).toBe('active')
    })

    it('refuses a hide with a whitespace-only reason', async () => {
      const staff = await staffWith({ status: true })
      const response = await hide(staff.headers, listingId, '   ')
      expect(response.statusCode).toBe(400)
    })

    it('accepts a hide WITH a real reason — the counter-assertion', async () => {
      const staff = await staffWith({ status: true })
      expect((await hide(staff.headers, listingId, 'Reported as a scam')).statusCode).toBe(200)
    })

    it('also requires a reason to remove', async () => {
      const staff = await staffWith({ delete: true })
      const response = await app.inject({
        method: 'DELETE', url: `/admin/marketplace/listings/${listingId}`, headers: staff.headers, payload: {},
      })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('the audit trail', () => {
    it('records actor, target and reason for a hide', async () => {
      const staff = await staffWith({ status: true })
      await hide(staff.headers, listingId, 'Suspicious pricing')

      const { rows } = await app.pg.query(
        `SELECT actor_id, actor_kind, target_type, target_id, detail FROM audit_log
          WHERE action = 'marketplace_listing_hidden' ORDER BY occurred_at DESC LIMIT 1`,
      )
      expect(rows).toHaveLength(1)
      expect(String(rows[0].actor_id)).toBe(staff.id)
      expect(rows[0].actor_kind).toBe('admin')
      expect(rows[0].target_type).toBe('marketplace_listing')
      expect(String(rows[0].target_id)).toBe(listingId)
      expect(rows[0].detail).toMatchObject({ reason: 'Suspicious pricing' })
    })

    it('records a restore too', async () => {
      const staff = await staffWith({ status: true })
      await hide(staff.headers, listingId, 'Hidden for review')
      await restore(staff.headers, listingId, 'Appeal upheld — listing was fine')

      const { rows } = await app.pg.query(
        `SELECT detail FROM audit_log WHERE action = 'marketplace_listing_restored' ORDER BY occurred_at DESC LIMIT 1`,
      )
      expect(rows[0].detail).toMatchObject({ reason: 'Appeal upheld — listing was fine' })
    })

    it('records a removal', async () => {
      const staff = await staffWith({ delete: true })
      await remove(staff.headers, listingId, 'Counterfeit goods')

      const { rows } = await app.pg.query(
        `SELECT target_id, detail FROM audit_log WHERE action = 'marketplace_listing_removed' ORDER BY occurred_at DESC LIMIT 1`,
      )
      expect(String(rows[0].target_id)).toBe(listingId)
      expect(rows[0].detail).toMatchObject({ reason: 'Counterfeit goods' })
    })
  })

  describe('visibility to the owner', () => {
    it('a hidden listing disappears from the member index', async () => {
      const staff = await staffWith({ status: true })
      await hide(staff.headers, listingId, 'Hidden for review')

      const index = await app.inject({ method: 'GET', url: '/marketplace/listings', headers: owner.headers })
      expect(index.json().items.map((l: { id: string }) => l.id)).not.toContain(listingId)
    })

    it('but stays visible to the OWNER at /marketplace/mine, marked hidden', async () => {
      const staff = await staffWith({ status: true })
      await hide(staff.headers, listingId, 'Hidden for review')

      const mine = await app.inject({ method: 'GET', url: '/marketplace/mine', headers: owner.headers })
      const found = mine.json().items.find((l: { id: string }) => l.id === listingId)
      // A member who cannot tell "hidden by staff" from "I deleted it by
      // accident" files a support ticket — this is the assertion that they
      // never have to.
      expect(found).toBeTruthy()
      expect(found.state).toBe('hidden')
    })

    it('restoring returns it to the index', async () => {
      const staff = await staffWith({ status: true })
      await hide(staff.headers, listingId, 'Hidden for review')
      await restore(staff.headers, listingId, 'Appeal upheld')

      const index = await app.inject({ method: 'GET', url: '/marketplace/listings', headers: owner.headers })
      expect(index.json().items.map((l: { id: string }) => l.id)).toContain(listingId)
    })
  })

  describe('staff cannot rewrite what a member said', () => {
    it('hide does not accept or apply a title/body change', async () => {
      const staff = await staffWith({ status: true })
      const response = await app.inject({
        method: 'POST', url: `/admin/marketplace/listings/${listingId}/hide`, headers: staff.headers,
        // A title sent alongside the reason must be silently ignored, not
        // applied — the schema for this route has no such field at all.
        payload: { reason: 'Policy violation', title: 'Rewritten by staff' },
      })
      expect(response.statusCode).toBe(200)

      const { rows } = await app.pg.query('SELECT title FROM marketplace_listings WHERE id = $1', [listingId])
      expect(rows[0].title).not.toBe('Rewritten by staff')
    })

    it('no endpoint in this module can PATCH the listing body', async () => {
      // The counter-assertion for the module doc's claim: `write`/`edit` are
      // unused here, and the member-facing PATCH stays owner-gated regardless
      // of what a staff member holds.
      const staff = await staffWith(true)
      const response = await app.inject({
        method: 'PATCH', url: `/marketplace/listings/${listingId}`, headers: staff.headers,
        payload: { title: 'Staff rewrite' },
      })
      // The member route requires `audience: 'member'`; a staff bearer is the
      // wrong audience entirely — a valid token for the wrong audience is
      // INSUFFICIENT_PERMISSION (403), not UNAUTHENTICATED (401).
      expect(response.statusCode).toBe(403)
    })
  })

  describe('reporting', () => {
    it('a member can report a listing', async () => {
      const reporter = await poster(app)
      const response = await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: reporter.headers,
        payload: { reason: 'Looks like a scam' },
      })
      expect(response.statusCode).toBe(201)
      expect(response.json().state).toBe('open')
    })

    it('refuses a second open report from the SAME member on the SAME listing', async () => {
      const reporter = await poster(app)
      await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: reporter.headers,
        payload: { reason: 'First report' },
      })
      const second = await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: reporter.headers,
        payload: { reason: 'Second report' },
      })
      expect(second.statusCode).toBe(400)
    })

    it('a DIFFERENT member reporting the same listing is fine — the counter-assertion', async () => {
      const first = await poster(app)
      const second = await poster(app)
      await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: first.headers,
        payload: { reason: 'First complaint' },
      })
      const response = await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: second.headers,
        payload: { reason: 'Second complaint' },
      })
      expect(response.statusCode).toBe(201)
    })

    it('staff can resolve a report, recorded in the audit log', async () => {
      const reporter = await poster(app)
      const created = await app.inject({
        method: 'POST', url: `/marketplace/listings/${listingId}/report`, headers: reporter.headers,
        payload: { reason: 'Scam' },
      })
      const staff = await staffWith({ status: true })

      const resolved = await app.inject({
        method: 'POST', url: `/admin/marketplace/reports/${created.json().id}/resolve`, headers: staff.headers,
        payload: { outcome: 'dismissed', reason: 'Investigated, listing is legitimate' },
      })
      expect(resolved.statusCode).toBe(200)
      expect(resolved.json().state).toBe('dismissed')

      const { rows } = await app.pg.query(
        `SELECT actor_id, detail FROM audit_log WHERE action = 'marketplace_report_resolved' ORDER BY occurred_at DESC LIMIT 1`,
      )
      expect(String(rows[0].actor_id)).toBe(staff.id)
      expect(rows[0].detail).toMatchObject({ reason: 'Investigated, listing is legitimate' })
    })
  })
})
