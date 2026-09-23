import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from './helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * What appears in the index, and what a direct request gets (FR-011, FR-012).
 *
 * Two separate rules that are easy to conflate:
 *
 *   * the OWNER's standing — §3.2 already decides that `locked`, `inactive`
 *     and `ended` members cannot sign in; their listings should not keep
 *     selling either. Joined live rather than denormalised, so a reinstated
 *     member's listings return on their own (research.md R7).
 *   * the LISTING's own state — withdrawn, sold, expired, hidden.
 *
 * §12 rule 13 governs the second: a URL that does not exist returns a
 * not-found status, never a success carrying fallback content.
 */

describe.skipIf(!hasDatabase)('the owner\'s standing cascades to their listings', () => {
  let app: GwcApp
  let headers: Record<string, string>

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    headers = (await poster(app)).headers
  })

  const browse = () => app.inject({ method: 'GET', url: '/marketplace/listings', headers })

  it('shows a listing from a member in good standing', async () => {
    // The counter-assertion, first. Without it every case below passes against
    // an index that returned nothing to anybody.
    const owner = await poster(app)
    await seedListing(app.pg, { ownerId: owner.id })
    expect((await browse()).json().items).toHaveLength(1)
  })

  it.each(['locked', 'inactive', 'ended'])(
    'hides listings whose owner is %s',
    async (status) => {
      const owner = await poster(app, { status })
      await seedListing(app.pg, { ownerId: owner.id })
      expect((await browse()).json().items).toHaveLength(0)
    },
  )

  it('returns them when the member is reinstated — no fan-out to replay', async () => {
    // The reason R7 joins live rather than denormalising a flag: reinstatement
    // needs no second write, and nothing can drift.
    const owner = await poster(app, { status: 'locked' })
    await seedListing(app.pg, { ownerId: owner.id })
    expect((await browse()).json().items).toHaveLength(0)

    await app.pg.query(`UPDATE members SET status = 'active' WHERE id = $1`, [owner.id])
    expect((await browse()).json().items).toHaveLength(1)
  })
})

describe.skipIf(!hasDatabase)('a listing that is not active', () => {
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

  const browse = () => app.inject({ method: 'GET', url: '/marketplace/listings', headers })
  const fetchOne = (id: string) =>
    app.inject({ method: 'GET', url: `/marketplace/listings/${id}`, headers })

  it('is reachable while active — the counter-assertion', async () => {
    const id = await seedListing(app.pg, { ownerId })
    expect((await fetchOne(id)).statusCode).toBe(200)
  })

  it.each(['withdrawn', 'sold', 'filled', 'expired', 'hidden'])(
    'is absent from the index when %s',
    async (state) => {
      await seedListing(app.pg, { ownerId, state })
      expect((await browse()).json().items).toHaveLength(0)
    },
  )

  it.each(['withdrawn', 'sold', 'filled', 'expired', 'hidden'])(
    'answers a direct request for a %s listing with gone, never a success',
    async (state) => {
      const id = await seedListing(app.pg, { ownerId, state })
      const response = await fetchOne(id)

      // §12 rule 13: never a 200 carrying fallback content. That is the
      // single-page-app soft-404 trap, and it is what this asserts against.
      expect(response.statusCode).not.toBe(200)
      expect([404, 410]).toContain(response.statusCode)
    },
  )

  it('answers a listing that never existed with 404', async () => {
    const response = await fetchOne('00000000-0000-4000-8000-000000000000')
    expect(response.statusCode).toBe(404)
  })
})
