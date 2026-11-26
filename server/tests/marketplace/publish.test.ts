import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { patchListing, poster, seedListing, resetMarketplace, TERMS } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Publishing and unpublishing (feature 037, US2, FR-005..FR-008, FR-017, FR-018).
 *
 * A draft must be invisible on EVERY surface a listing can appear on — browse,
 * the direct link, the public counts and a new request — and each assertion has
 * a counter-assertion where the same listing, published, IS visible, so a pass
 * cannot come from a server that shows nothing to anybody.
 */

describe.skipIf(!hasDatabase)('publishing a listing', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let other: Awaited<ReturnType<typeof poster>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    other = await poster(app)
  })

  const listing = (over: Record<string, unknown> = {}) => ({
    category: 'general', mode: 'offer',
    title: 'Bicycle repair service',
    body: 'I service road and city bikes in Dubai Marina. Collection possible.',
    details: { kind: 'service', price_minor: 15000, currency: 'AED' },
    termsVersion: TERMS,
    ...over,
  })
  const post = (headers: Record<string, string>, over: Record<string, unknown> = {}) =>
    app.inject({ method: 'POST', url: '/marketplace/listings', headers, payload: listing(over) })

  const browseTitles = async (headers = other.headers) =>
    ((await app.inject({ method: 'GET', url: '/marketplace/listings', headers })).json().items as Array<{ title: string }>).map((i) => i.title)
  const detail = (id: string, headers = other.headers) =>
    app.inject({ method: 'GET', url: `/marketplace/listings/${id}`, headers })
  const publicTotal = async () =>
    (await app.inject({ method: 'GET', url: '/marketplace/summary' })).json().total as number
  const inquire = (id: string, headers = other.headers) =>
    app.inject({ method: 'POST', url: `/marketplace/listings/${id}/inquire`, headers, payload: { body: 'Is this still available?' } })

  it('creates a live listing when `publish` is not sent (back-compat, FR-018)', async () => {
    const response = await post(owner.headers)
    expect(response.statusCode).toBe(201)
    expect(response.json().state).toBe('active')
    expect(await browseTitles()).toContain('Bicycle repair service')
  })

  it('creates a private draft with `publish: false`, invisible on every surface', async () => {
    const created = await post(owner.headers, { publish: false })
    expect(created.statusCode).toBe(201)
    const id = created.json().id
    expect(created.json().state).toBe('draft')
    expect(created.json().publishedAt).toBeNull()

    expect(await browseTitles()).not.toContain('Bicycle repair service')
    expect((await detail(id)).statusCode).toBe(410)
    expect(await publicTotal()).toBe(0)
    expect((await inquire(id)).statusCode).not.toBe(201)
    // The owner still sees it, and may open it.
    const mine = await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers: owner.headers })
    expect(mine.statusCode).toBe(200)
  })

  it('shows it on every surface once published, and hides it again when unpublished', async () => {
    const id = (await post(owner.headers, { publish: false })).json().id

    const live = await patchListing(app, owner.headers, id, { published: true })
    expect(live.statusCode).toBe(200)
    expect(live.json().state).toBe('active')
    expect(live.json().publishedAt).not.toBeNull()
    expect(await browseTitles()).toContain('Bicycle repair service')
    expect((await detail(id)).statusCode).toBe(200)
    expect(await publicTotal()).toBe(1)
    expect((await inquire(id)).statusCode).toBe(201)

    const back = await patchListing(app, owner.headers, id, { published: false })
    expect(back.json().state).toBe('draft')
    expect(await browseTitles()).not.toContain('Bicycle repair service')
    expect((await detail(id)).statusCode).toBe(410)
    expect(await publicTotal()).toBe(0)
    // A conversation started while it was live survives, but nobody can start another.
    const { rows } = await app.pg.query('SELECT 1 FROM conversations')
    expect(rows).toHaveLength(1)
    const stranger = await poster(app)
    expect((await inquire(id, stranger.headers)).statusCode).not.toBe(201)
  })

  it('keeps the original publication time when unpublished and published again', async () => {
    const id = (await post(owner.headers)).json().id
    const first = (await app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers: owner.headers })).json().publishedAt
    await patchListing(app, owner.headers, id, { published: false })
    const again = await patchListing(app, owner.headers, id, { published: true })
    expect(new Date(again.json().publishedAt).toISOString()).toBe(new Date(first).toISOString())
  })

  it('republishes an expired listing only with a future expiry in the same save', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'expired' })
    await app.pg.query(`UPDATE marketplace_listings SET expires_at = published_at + interval '1 millisecond' WHERE id = $1`, [id])

    const refused = await patchListing(app, owner.headers, id, { published: true })
    expect(refused.statusCode).toBe(400)
    expect(refused.json().detail).toMatch(/expiresAt/)
    expect((await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [id])).rows[0].state).toBe('expired')

    const future = new Date(Date.now() + 14 * 86_400_000).toISOString()
    const ok = await patchListing(app, owner.headers, id, { published: true, expiresAt: future })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().state).toBe('active')
  })

  it('refuses a draft with a past expiry being published, and leaves it a draft', async () => {
    const created = await post(owner.headers, { publish: false, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
    const id = created.json().id
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const refused = await patchListing(app, owner.headers, id, { published: true, expiresAt: past })
    expect(refused.statusCode).toBe(400)
    expect((await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [id])).rows[0].state).toBe('draft')
  })

  it('refuses the owner publishing a listing staff disabled (FR-008)', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'hidden', hiddenFromState: 'draft', published: false })
    const response = await patchListing(app, owner.headers, id, { published: true })
    expect(response.statusCode).toBe(409)
    expect(response.json().type).toMatch(/marketplace\/not-editable$/)
    expect((await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [id])).rows[0].state).toBe('hidden')
  })

  it('still refuses publishing a legacy draft job offer (the database trigger behind the 422)', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, category: 'job', mode: 'offer', state: 'draft' })
    const response = await patchListing(app, owner.headers, id, { published: true })
    expect(response.statusCode).toBe(422)
    expect(response.json().type).toMatch(/mode-not-allowed$/)
    expect((await app.pg.query('SELECT state FROM marketplace_listings WHERE id = $1', [id])).rows[0].state).toBe('draft')
  })

  it('counts a draft toward the 20-listing limit (clarification Q5)', async () => {
    for (let i = 0; i < 20; i += 1) expect((await post(owner.headers, { publish: false })).statusCode).toBe(201)
    const twentyFirst = await post(owner.headers, { publish: false })
    expect(twentyFirst.statusCode).toBe(422)
    expect(twentyFirst.json().type).toMatch(/quota-exceeded$/)
  })

  it('writes one state-change audit entry per publish and per unpublish, and none for a failed one', async () => {
    const id = (await post(owner.headers, { publish: false })).json().id
    await patchListing(app, owner.headers, id, { published: true })
    await patchListing(app, owner.headers, id, { published: false })
    await patchListing(app, owner.headers, id, { published: true, expiresAt: new Date(Date.now() - 1000).toISOString() })

    const { rows } = await app.pg.query(
      `SELECT detail FROM audit_log WHERE action = 'marketplace_listing_state_changed' AND target_id = $1 ORDER BY occurred_at`,
      [id],
    )
    expect(rows.map((r) => r.detail)).toEqual([
      expect.objectContaining({ statusFrom: 'draft', statusTo: 'active' }),
      expect.objectContaining({ statusFrom: 'active', statusTo: 'draft' }),
    ])
  })

  it('does not audit an edit that leaves the state alone', async () => {
    const id = (await post(owner.headers)).json().id
    await patchListing(app, owner.headers, id, { title: 'Only the title changes' })
    const { rows } = await app.pg.query(
      `SELECT 1 FROM audit_log WHERE action = 'marketplace_listing_state_changed' AND target_id = $1`, [id],
    )
    expect(rows).toHaveLength(0)
  })
})
