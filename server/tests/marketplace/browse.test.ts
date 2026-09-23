import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import { MARKETPLACE_CATEGORIES, MARKETPLACE_MODES } from '@gwc/contracts/marketplace'
import type { GwcApp } from '../../src/app.ts'

/**
 * Browsing and filtering (US2, FR-010, SC-002).
 *
 * Every category × mode combination, against a corpus that actually spans
 * them. A filter suite run against listings of one kind proves only that the
 * query does not crash.
 */

describe.skipIf(!hasDatabase)('the marketplace index', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    const owner = await poster(app)
    headers = owner.headers
    // One listing per category per mode: 4 × 2 = 8.
    for (const category of MARKETPLACE_CATEGORIES) {
      for (const mode of MARKETPLACE_MODES) {
        await seedListing(app.pg, { ownerId: owner.id, category, mode })
      }
    }
  })

  const browse = (query = '') =>
    app.inject({ method: 'GET', url: `/marketplace/listings${query}`, headers })

  it('returns the whole active corpus unfiltered', async () => {
    const response = await browse()
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toHaveLength(8)
  })

  it.each(MARKETPLACE_CATEGORIES)('filters to category=%s and nothing else', async (category) => {
    const items = (await browse(`?category=${category}`)).json().items
    expect(items).toHaveLength(2)
    expect(items.every((i: { category: string }) => i.category === category)).toBe(true)
  })

  it.each(MARKETPLACE_MODES)('filters to mode=%s and nothing else', async (mode) => {
    const items = (await browse(`?mode=${mode}`)).json().items
    expect(items).toHaveLength(4)
    expect(items.every((i: { mode: string }) => i.mode === mode)).toBe(true)
  })

  it('filters on category AND mode together', async () => {
    const items = (await browse('?category=vehicle&mode=request')).json().items
    expect(items).toHaveLength(1)
    expect(items[0].category).toBe('vehicle')
    expect(items[0].mode).toBe('request')
  })

  it('orders newest first', async () => {
    const items = (await browse()).json().items
    const dates = items.map((i: { createdAt: string }) => new Date(i.createdAt).getTime())
    expect(dates).toEqual([...dates].sort((a, b) => b - a))
  })
})

describe.skipIf(!hasDatabase)('per-category filters', () => {
  let app: GwcApp
  let headers: Record<string, string>
  let ownerId: string

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    const owner = await poster(app)
    headers = owner.headers
    ownerId = owner.id
  })

  const browse = (query: string) =>
    app.inject({ method: 'GET', url: `/marketplace/listings?${query}`, headers })

  it('filters vehicles by make', async () => {
    await seedListing(app.pg, { ownerId, category: 'vehicle', details: { make: 'Toyota' } })
    await seedListing(app.pg, { ownerId, category: 'vehicle', details: { make: 'Porsche' } })

    const items = (await browse('category=vehicle&make=Porsche')).json().items
    expect(items).toHaveLength(1)
    expect(items[0].details.make).toBe('Porsche')
  })

  it('filters vehicles by price range', async () => {
    await seedListing(app.pg, { ownerId, category: 'vehicle', details: { make: 'A', price_minor: 500000 } })
    await seedListing(app.pg, { ownerId, category: 'vehicle', details: { make: 'B', price_minor: 5000000 } })

    const items = (await browse('category=vehicle&price_minor_min=1000000')).json().items
    expect(items).toHaveLength(1)
    expect(Number(items[0].details.price_minor)).toBe(5000000)
  })

  it('filters property by deal and city', async () => {
    await seedListing(app.pg, { ownerId, category: 'property', details: { deal: 'rent', city: 'Dubai' } })
    await seedListing(app.pg, { ownerId, category: 'property', details: { deal: 'sale', city: 'Dubai' } })
    await seedListing(app.pg, { ownerId, category: 'property', details: { deal: 'rent', city: 'Berlin' } })

    expect((await browse('category=property&deal=rent')).json().items).toHaveLength(2)
    expect((await browse('category=property&city=Berlin')).json().items).toHaveLength(1)
  })

  it('filters property by rooms — half-rooms included', async () => {
    await seedListing(app.pg, { ownerId, category: 'property', details: { deal: 'rent', city: 'X', rooms: 2.5 } })
    await seedListing(app.pg, { ownerId, category: 'property', details: { deal: 'rent', city: 'X', rooms: 4 } })

    const items = (await browse('category=property&rooms_min=3')).json().items
    expect(items).toHaveLength(1)
    expect(Number(items[0].details.rooms)).toBe(4)
  })

  it('filters jobs by city and seniority', async () => {
    await seedListing(app.pg, { ownerId, category: 'job', details: { employment_type: 'full_time', city: 'Dubai', seniority: 'senior' } })
    await seedListing(app.pg, { ownerId, category: 'job', details: { employment_type: 'full_time', city: 'Dubai', seniority: 'junior' } })

    const items = (await browse('category=job&seniority=senior')).json().items
    expect(items).toHaveLength(1)
  })

  it('filters general by kind — product versus service', async () => {
    // The one discriminator `general` keeps, because a service priced per hour
    // and a product priced once read differently in an index.
    await seedListing(app.pg, { ownerId, category: 'general', details: { kind: 'service' } })
    await seedListing(app.pg, { ownerId, category: 'general', details: { kind: 'product' } })

    const items = (await browse('category=general&kind=service')).json().items
    expect(items).toHaveLength(1)
    expect(items[0].details.kind).toBe('service')
  })

  it('ignores a category filter it does not recognise rather than guessing', async () => {
    await seedListing(app.pg, { ownerId, category: 'vehicle', details: { make: 'Toyota' } })
    const response = await browse('category=vehicle&nonsense=1')
    expect(response.statusCode).toBe(400)
  })
})
