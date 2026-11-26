import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The owner's read of their own listing (feature 037, research R8).
 *
 * `GET /marketplace/listings/:id` is the visibility rule and shows active
 * listings only. The edit form needs the owner's listing in ANY state, so it
 * has its own route — and that route must never become a way to read someone
 * else's. The flags and the version must also reach the wire: the response
 * serializer drops any key its schema does not declare, so a field added only
 * to the handler would pass a unit test and never be sent.
 */

describe.skipIf(!hasDatabase)('GET /marketplace/mine/:id and the own-listing list', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
  })

  const mine = (id: string, headers: Record<string, string> = owner.headers) =>
    app.inject({ method: 'GET', url: `/marketplace/mine/${id}`, headers })

  const FLAGS: Record<string, { canEdit: boolean; canPublish: boolean; moderated: boolean }> = {
    draft: { canEdit: true, canPublish: true, moderated: false },
    active: { canEdit: true, canPublish: false, moderated: false },
    expired: { canEdit: true, canPublish: true, moderated: false },
    sold: { canEdit: false, canPublish: false, moderated: false },
    filled: { canEdit: false, canPublish: false, moderated: false },
    withdrawn: { canEdit: false, canPublish: false, moderated: false },
    hidden: { canEdit: false, canPublish: false, moderated: true },
  }

  it.each(Object.keys(FLAGS))('returns a %s listing to its owner with the right flags and a version', async (state) => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state })
    const response = await mine(id)
    expect(response.statusCode).toBe(200)
    const body = response.json()
    // On the WIRE, not just in the handler.
    expect(body.version).toEqual(expect.any(String))
    expect(body).toMatchObject(FLAGS[state]!)
    expect(body.state).toBe(state)
    expect(body.details).toBeTypeOf('object')
    expect(body.features).toEqual(expect.any(Array))
  })

  it('never returns a contact value, only the preference', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id })
    const text = (await mine(id)).body
    expect(text).not.toMatch(/@test\.invalid|\+\d{8,}/)
    expect(JSON.parse(text).contact).toMatchObject({ method: 'platform_message' })
  })

  it('answers a non-owner exactly as it answers an unknown id', async () => {
    const stranger = await poster(app)
    const id = await seedListing(app.pg, { ownerId: owner.id })
    const refused = await mine(id, stranger.headers)
    const unknown = await mine('00000000-0000-4000-8000-000000000000', stranger.headers)
    expect(refused.statusCode).toBe(404)
    expect(refused.statusCode).toBe(unknown.statusCode)
    expect(JSON.parse(refused.body).type).toBe(JSON.parse(unknown.body).type)
    // The counter-assertion: the owner does get it.
    expect((await mine(id)).statusCode).toBe(200)
  })

  it('does not tell the owner who disabled it or why', async () => {
    const id = await seedListing(app.pg, { ownerId: owner.id, state: 'hidden', hiddenFromState: 'active' })
    const body = (await mine(id)).json()
    expect(body.moderated).toBe(true)
    expect(JSON.stringify(body)).not.toMatch(/reason|hiddenFrom|hidden_from/i)
  })

  it('lists every state with the flags, so the list needs no second request', async () => {
    for (const state of Object.keys(FLAGS)) await seedListing(app.pg, { ownerId: owner.id, state })
    const response = await app.inject({ method: 'GET', url: '/marketplace/mine', headers: owner.headers })
    const items = response.json().items as Array<{ state: string; version: string; canEdit: boolean }>
    expect(items).toHaveLength(Object.keys(FLAGS).length)
    for (const item of items) {
      expect(item.version).toEqual(expect.any(String))
      expect(item.canEdit).toBe(FLAGS[item.state]!.canEdit)
    }
  })
})
