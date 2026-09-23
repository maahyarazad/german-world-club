import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import { boundedLimit, DEFAULT_LIMIT, MAX_LIMIT } from '../../src/modules/marketplace/controller.ts'
import * as browse from '../../src/modules/marketplace/application/browse.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * `limit` — the sharpest parameter in this feature (FR-010, research.md R8).
 *
 * `specs/007-typescript-migration/data-model.md` §4b traced the existing
 * `campaignQuery.limit` from `request.query` into a SQL `LIMIT` and found that
 * removing its Zod schema without replacing the coercion produces THREE
 * regressions at once:
 *
 *   1. the string `"50"` instead of the number 50
 *   2. `undefined` instead of the default when the parameter is absent
 *   3. no upper bound at all, so `?limit=1000000` is served
 *
 * This is the second such parameter in the codebase, and feature 007 Phase 6
 * will delete its schema too. All three are asserted here — bounding alone is
 * not enough.
 */

describe('boundedLimit — the unit that survives Phase 6', () => {
  it('coerces a string to a number', () => {
    expect(boundedLimit('30')).toBe(30)
    expect(typeof boundedLimit('30')).toBe('number')
  })

  it('defaults when absent', () => {
    expect(boundedLimit(undefined)).toBe(DEFAULT_LIMIT)
    expect(boundedLimit('')).toBe(DEFAULT_LIMIT)
  })

  it('bounds an absurd value', () => {
    expect(boundedLimit('1000000')).toBe(MAX_LIMIT)
    expect(boundedLimit(Number.MAX_SAFE_INTEGER)).toBe(MAX_LIMIT)
  })

  it('refuses nonsense rather than passing it through', () => {
    expect(boundedLimit('abc')).toBe(DEFAULT_LIMIT)
    expect(boundedLimit(-5)).toBe(DEFAULT_LIMIT)
    expect(boundedLimit(0)).toBe(DEFAULT_LIMIT)
  })
})

describe.skipIf(!hasDatabase)('limit through the real endpoint', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    const owner = await poster(app)
    headers = owner.headers
    for (let i = 0; i < 60; i += 1) {
      await seedListing(app.pg, { ownerId: owner.id, title: `Listing ${i}` })
    }
  })

  const browseUrl = (q = '') =>
    app.inject({ method: 'GET', url: `/marketplace/listings${q}`, headers })

  it('serves at most MAX_LIMIT however large the request', async () => {
    const response = await browseUrl('?limit=1000000')
    expect(response.statusCode).toBe(200)
    expect(response.json().items.length).toBeLessThanOrEqual(MAX_LIMIT)
  })

  it('serves the default when limit is absent — and does not error', async () => {
    const response = await browseUrl()
    expect(response.statusCode).toBe(200)
    expect(response.json().items).toHaveLength(DEFAULT_LIMIT)
  })

  it('reaches the application layer as a NUMBER, not the string "30"', async () => {
    // The regression that hides: a string flows into SQL, Postgres coerces it,
    // everything looks right, and the bound silently stops applying the day a
    // non-numeric string arrives.
    const spy = vi.spyOn(browse, 'browseListings')
    await browseUrl('?limit=30')

    expect(spy).toHaveBeenCalled()
    const passed = spy.mock.calls[0]![1].limit
    expect(typeof passed, '`limit` reached the application layer as a string').toBe('number')
    expect(passed).toBe(30)
    spy.mockRestore()
  })

  it('pages with an opaque cursor rather than an offset', async () => {
    const first = (await browseUrl('?limit=10')).json()
    expect(first.items).toHaveLength(10)
    expect(first.nextCursor).toBeTruthy()

    const second = (await browseUrl(`?limit=10&cursor=${encodeURIComponent(first.nextCursor)}`)).json()
    expect(second.items).toHaveLength(10)

    // No overlap. Offset paging repeats rows when the corpus grows mid-scroll,
    // which is the shape a classifieds index actually has.
    const firstIds = new Set(first.items.map((i: { id: string }) => i.id))
    expect(second.items.some((i: { id: string }) => firstIds.has(i.id))).toBe(false)
  })

  it('refuses an unparseable cursor rather than silently restarting', async () => {
    // Silently resetting to page one is how a client loops forever.
    const response = await browseUrl('?cursor=not-a-cursor')
    expect(response.statusCode).toBe(400)
  })
})
