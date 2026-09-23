import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Owning your own listings (US3, FR-003, FR-004, SC-006).
 *
 * The headline assertion: another member's refusal and a listing that never
 * existed must be **indistinguishable** — status, body and headers compared,
 * not just status codes. A 403 (or a 404 with a differently-worded body) would
 * confirm the id belongs to a real listing, which for a member's classifieds
 * is exactly the disclosure `guardOrganisationScope` exists to prevent
 * elsewhere in this codebase.
 */

describe.skipIf(!hasDatabase)('a member manages their own listings', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let stranger: Awaited<ReturnType<typeof poster>>
  let listingId: string
  let absentId: string

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    stranger = await poster(app)
    listingId = await seedListing(app.pg, { ownerId: owner.id, category: 'general' })
    absentId = '00000000-0000-0000-0000-000000000000'
  })

  const patch = (id: string, headers: Record<string, string>, body: unknown) =>
    app.inject({ method: 'PATCH', url: `/marketplace/listings/${id}`, headers, payload: body as never })

  const setState = (id: string, headers: Record<string, string>, state: string) =>
    app.inject({ method: 'POST', url: `/marketplace/listings/${id}/state`, headers, payload: { state } })

  const get = (id: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url: `/marketplace/listings/${id}`, headers })

  /** Strip request-specific fields so two responses can be compared for equality. */
  const canonical = (r: { statusCode: number; headers: Record<string, unknown>; json: () => Record<string, unknown> }) => ({
    statusCode: r.statusCode,
    body: { ...r.json(), instance: null },
    // These differ on every request by construction and carry no
    // ownership information: `x-request-id`/`date` are per-request,
    // `content-security-policy` embeds a fresh nonce each response,
    // `etag` is a hash that moves with it, and `ratelimit-remaining`
    // decrements with every call this test itself makes. Comparing any of
    // them would make an identical ANSWER look different for reasons that
    // have nothing to do with what the answer discloses.
    headers: Object.fromEntries(
      Object.entries(r.headers).filter(([k]) => ![
        'x-request-id', 'date', 'content-length',
        'content-security-policy', 'etag', 'ratelimit-remaining',
      ].includes(k)),
    ),
  })

  describe('editing', () => {
    it('lets the owner edit successfully', async () => {
      const response = await patch(listingId, owner.headers, { title: 'A better title' })
      expect(response.statusCode).toBe(200)
      expect(response.json().title).toBe('A better title')
    })

    it('refuses another member with 404', async () => {
      const response = await patch(listingId, stranger.headers, { title: 'Hijacked' })
      expect(response.statusCode).toBe(404)
    })

    it('answers IDENTICALLY for someone else\'s listing and one that never existed', async () => {
      const belongsToSomeoneElse = await patch(listingId, stranger.headers, { title: 'A valid new title' })
      const neverExisted = await patch(absentId, stranger.headers, { title: 'A valid new title' })
      expect(canonical(belongsToSomeoneElse)).toEqual(canonical(neverExisted))
    })

    it('leaves the listing UNCHANGED after a refused edit', async () => {
      await patch(listingId, stranger.headers, { title: 'Hijacked' })
      const after = await get(listingId, owner.headers)
      expect(after.json().title).not.toBe('Hijacked')
    })
  })

  describe('GET is not an ownership question while a listing is active', () => {
    // Browsing (US2) is deliberately open: any member may GET any ACTIVE
    // listing, owner or not. SC-006's "cannot read another member's listing"
    // is answered by visibility, not by an ownership check on GET — once a
    // listing stops being active, FR-012 governs what GET returns (`gone` for
    // one that existed, `not-found` for one that never did), and that split
    // is deliberate and already covered by visibility.test.ts. It is NOT the
    // same guarantee as edit's, so it is not asserted identical here.
    it('lets a non-owner read an active listing — the counter-assertion', async () => {
      const response = await get(listingId, stranger.headers)
      expect(response.statusCode).toBe(200)
    })

    it('STILL refuses a non-owner editing that same, readable listing', async () => {
      const response = await patch(listingId, stranger.headers, { title: 'Not yours to change' })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('state transitions', () => {
    it('lets the owner mark it sold', async () => {
      const response = await setState(listingId, owner.headers, 'sold')
      expect(response.statusCode).toBe(200)
      expect(response.json().state).toBe('sold')
    })

    it('lets the owner mark it filled', async () => {
      const response = await setState(listingId, owner.headers, 'filled')
      expect(response.statusCode).toBe(200)
      expect(response.json().state).toBe('filled')
    })

    it('lets the owner withdraw it', async () => {
      const response = await setState(listingId, owner.headers, 'withdrawn')
      expect(response.statusCode).toBe(200)
      expect(response.json().state).toBe('withdrawn')
    })

    it('refuses another member, 404', async () => {
      const response = await setState(listingId, stranger.headers, 'withdrawn')
      expect(response.statusCode).toBe(404)

      // And it genuinely did nothing.
      const after = await get(listingId, owner.headers)
      expect(after.json().state).toBe('active')
    })

    it('refuses a state a member may never request, even as the owner', async () => {
      const response = await setState(listingId, owner.headers, 'hidden')
      // Schema-level refusal: 'hidden' is not in the member-settable enum.
      expect(response.statusCode).toBe(400)
    })

    it('refuses moving OUT of a terminal state — a sold listing is not re-posted', async () => {
      await setState(listingId, owner.headers, 'sold')
      const response = await setState(listingId, owner.headers, 'withdrawn')
      expect(response.statusCode).toBe(400)
    })

    it('writes an audit entry for the transition', async () => {
      await setState(listingId, owner.headers, 'sold')
      const { rows } = await app.pg.query(
        `SELECT action, actor_id, target_id, detail FROM audit_log
          WHERE action = 'marketplace_listing_state_changed' AND target_id = $1
          ORDER BY occurred_at DESC LIMIT 1`,
        [listingId],
      )
      expect(rows).toHaveLength(1)
      expect(String(rows[0].actor_id)).toBe(owner.id)
      expect(rows[0].detail).toMatchObject({ statusFrom: 'active', statusTo: 'sold' })
    })
  })

  describe('category change on edit', () => {
    it('clears the old category\'s fields and validates the new one', async () => {
      const vehicleListing = await seedListing(app.pg, {
        ownerId: owner.id, category: 'vehicle', details: { make: 'Honda' },
      })

      const response = await patch(vehicleListing, owner.headers, {
        category: 'general', details: { kind: 'service' },
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().category).toBe('general')

      const { rows: vehicleRows } = await app.pg.query(
        'SELECT 1 FROM marketplace_vehicle_details WHERE listing_id = $1', [vehicleListing],
      )
      expect(vehicleRows).toHaveLength(0)

      const { rows: generalRows } = await app.pg.query(
        'SELECT kind FROM marketplace_general_details WHERE listing_id = $1', [vehicleListing],
      )
      expect(generalRows[0].kind).toBe('service')
    })

    it('refuses a category change whose new details do not validate', async () => {
      const response = await patch(listingId, owner.headers, {
        category: 'vehicle', details: {},
      })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /marketplace/mine', () => {
    it('includes hidden and withdrawn listings the index would never show', async () => {
      const withdrawn = await seedListing(app.pg, { ownerId: owner.id, state: 'withdrawn' })
      const hidden = await seedListing(app.pg, { ownerId: owner.id, state: 'hidden' })

      const mine = await app.inject({ method: 'GET', url: '/marketplace/mine', headers: owner.headers })
      const ids = mine.json().items.map((l: { id: string }) => l.id)

      expect(ids).toContain(listingId)
      expect(ids).toContain(withdrawn)
      expect(ids).toContain(hidden)
    })

    it('never includes another member\'s listings', async () => {
      const mine = await app.inject({ method: 'GET', url: '/marketplace/mine', headers: stranger.headers })
      expect(mine.json().items.map((l: { id: string }) => l.id)).not.toContain(listingId)
    })
  })
})
