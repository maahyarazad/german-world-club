import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { patchListing, poster, seedListing, resetMarketplace, staffWithModeration } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Disabling and enabling remember where a listing came from (feature 037,
 * FR-011, FR-013, clarification Q2).
 *
 * Staff disable a published or draft listing. Enabling puts it back exactly
 * where its owner left it — and above all never publishes a draft.
 */

describe.skipIf(!hasDatabase)('disable and enable', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let staff: Awaited<ReturnType<typeof staffWithModeration>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    staff = await staffWithModeration(app, { read: true, status: true })
  })

  const act = (action: 'hide' | 'restore', id: string, reason = 'A good reason') =>
    app.inject({ method: 'POST', url: `/admin/marketplace/listings/${id}/${action}`, headers: staff.headers, payload: { reason } })
  const row = async (id: string) =>
    (await app.pg.query('SELECT state, hidden_from_state, published_at FROM marketplace_listings WHERE id = $1', [id])).rows[0]
  const audit = async (action: string, id: string) =>
    (await app.pg.query(`SELECT actor_id, detail FROM audit_log WHERE action = $1 AND target_id = $2 ORDER BY occurred_at DESC`, [action, id])).rows

  it('disables an active listing and enables it back to active', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    expect((await act('hide', id)).statusCode).toBe(200)
    expect(await row(id)).toMatchObject({ state: 'hidden', hidden_from_state: 'active' })

    const back = await act('restore', id)
    expect(back.statusCode).toBe(200)
    expect(back.json().state).toBe('active')
    expect(await row(id)).toMatchObject({ state: 'active', hidden_from_state: null })
  })

  it('disables a DRAFT, and enabling returns a draft — it is never published', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'draft' })
    expect((await act('hide', id)).statusCode).toBe(200)
    expect(await row(id)).toMatchObject({ state: 'hidden', hidden_from_state: 'draft' })

    const back = await act('restore', id)
    expect(back.json().state).toBe('draft')
    const after = await row(id)
    expect(after.state).toBe('draft')
    expect(after.published_at).toBeNull()
  })

  it('restores a legacy hidden row (no remembered state) to active, as it always did', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'hidden' })
    expect((await row(id)).hidden_from_state).toBeNull()
    expect((await act('restore', id)).json().state).toBe('active')
  })

  it.each(['expired', 'sold', 'filled', 'withdrawn'])('offers no disable for a %s listing', async (state) => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state })
    const response = await act('hide', id)
    expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect((await row(id)).state).toBe(state)
  })

  it('refuses enabling a listing that is not disabled', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    expect((await act('restore', id)).statusCode).toBeGreaterThanOrEqual(400)
  })

  it('needs a reason for both, and records actor, reason and the REAL states', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'draft' })
    expect((await act('hide', id, '  ')).statusCode).toBe(400)
    expect((await row(id)).state).toBe('draft')

    await act('hide', id, 'Prohibited item')
    await act('restore', id, 'Appeal upheld')
    const hidden = await audit('marketplace_listing_hidden', id)
    const restored = await audit('marketplace_listing_restored', id)
    expect(hidden).toHaveLength(1)
    expect(String(hidden[0].actor_id)).toBe(staff.id)
    expect(hidden[0].detail).toMatchObject({ reason: 'Prohibited item', statusFrom: 'draft', statusTo: 'hidden' })
    expect(restored[0].detail).toMatchObject({ reason: 'Appeal upheld', statusFrom: 'hidden', statusTo: 'draft' })
  })

  it('takes a disabled listing off every member surface on the next request, and puts it back', async () => {
    const viewer = await poster(app)
    const id = await seedListing(app.pg, { ownerId: owner.id, title: 'Soon disabled' })
    const visible = async () => ((await app.inject({ method: 'GET', url: '/marketplace/listings', headers: viewer.headers })).json().items as Array<{ title: string }>).map((i) => i.title)
    const total = async () => (await app.inject({ method: 'GET', url: '/marketplace/summary' })).json().total as number
    expect(await visible()).toContain('Soon disabled')
    expect(await total()).toBe(1)

    await act('hide', id)
    expect(await visible()).not.toContain('Soon disabled')
    expect((await app.inject({ method: 'GET', url: `/marketplace/listings/${id}`, headers: viewer.headers })).statusCode).toBe(410)
    expect(await total()).toBe(0)

    await act('restore', id)
    expect(await visible()).toContain('Soon disabled')
    expect(await total()).toBe(1)
  })

  it('tells the owner it was disabled by staff, without a reason, and blocks the edit', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    await act('hide', id, 'Internal note the owner must not see')
    const mine = await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers: owner.headers })
    expect(mine.json()).toMatchObject({ moderated: true, canEdit: false, canPublish: false })
    expect(mine.body).not.toMatch(/Internal note/)
    const edit = await patchListing(app, owner.headers, id, { title: 'Trying anyway' })
    expect(edit.statusCode).toBe(409)
  })

  it('an edit racing a disable is refused and nothing is overwritten', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, title: 'Before' })
    const version = (await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers: owner.headers })).json().version
    await act('hide', id)
    const save = await app.inject({
      method: 'PATCH', url: `/marketplace/listings/${id}`, headers: owner.headers, payload: { version, title: 'After' },
    })
    expect(save.statusCode).toBe(409)
    expect(save.json().type).toMatch(/not-editable$/)
    expect((await app.pg.query('SELECT title FROM marketplace_listings WHERE id = $1', [id])).rows[0].title).toBe('Before')
  })
})
