import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { ownVersion, poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Two devices editing one listing (feature 037, FR-009, research R5).
 *
 * The web and the app can both hold a form for the same listing. The second
 * save must be told the listing changed, not silently overwrite the first.
 */

describe.skipIf(!hasDatabase)('concurrent edits of one listing', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let id: string

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)
    id = await seedListing(app.pg, { ownerId: owner.id, title: 'The original title' })
  })

  const save = (version: string, title: string) =>
    app.inject({
      method: 'PATCH', url: `/marketplace/listings/${id}`, headers: owner.headers,
      payload: { version, title },
    })
  const titleNow = async () =>
    String((await app.pg.query('SELECT title FROM marketplace_listings WHERE id = $1', [id])).rows[0].title)

  it('refuses the second save made from an older version, and writes nothing', async () => {
    const both = await ownVersion(app, owner.headers, id)

    const first = await save(both, 'Saved from the web')
    expect(first.statusCode).toBe(200)

    const second = await save(both, 'Saved from the app')
    expect(second.statusCode).toBe(409)
    expect(second.json().type).toMatch(/conflict$/)
    // Nothing of the stale save landed.
    expect(await titleNow()).toBe('Saved from the web')
  })

  it('accepts a save made from the version the first one returned', async () => {
    const start = await ownVersion(app, owner.headers, id)
    const first = await save(start, 'First change')
    expect(first.json().version).toBeTruthy()
    expect(first.json().version).not.toBe(start)

    const second = await save(first.json().version, 'Second change')
    expect(second.statusCode).toBe(200)
    expect(await titleNow()).toBe('Second change')
  })

  it('answers 400 when no version is sent at all', async () => {
    const response = await app.inject({
      method: 'PATCH', url: `/marketplace/listings/${id}`, headers: owner.headers,
      payload: { title: 'No version sent' },
    })
    expect(response.statusCode).toBe(400)
    expect(await titleNow()).toBe('The original title')
  })
})
