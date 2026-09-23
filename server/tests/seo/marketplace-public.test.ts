import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { buildAuthApp, resetAuthTables } from '../helpers/auth.ts'
import { hasDatabase } from '../helpers/db.ts'
import { poster, seedListing, resetMarketplace } from '../marketplace/helpers.ts'
import { surfaceByName, disallowedPrefixes } from '../../src/modules/seo/surfaces.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * The public marketplace discovery page (US7, FR-034, FR-035, SC-015).
 *
 * The independent test named in tasks.md: fetch it signed out, against a
 * SEEDED corpus, and scan the rendered output — not the template — for any
 * seeded listing's id, title, photo URL or price. Finding none, while the
 * page still names the categories and a non-zero count, is the assertion.
 *
 * Scanning the rendered output matters specifically: a template with no
 * interpolation for listing rows would pass a test that only inspected the
 * template file, and prove nothing about what a real request returns.
 */

describe.skipIf(!hasDatabase)('the public marketplace discovery page', () => {
  let app: GwcApp
  let owner: Awaited<ReturnType<typeof poster>>
  let secretTitle: string
  let secretListingId: string

  beforeAll(async () => { app = await buildAuthApp() })
  afterAll(async () => { await app.close() })

  beforeEach(async () => {
    await resetMarketplace(app.pg)
    await resetAuthTables(app.pg)
    owner = await poster(app)

    // A distinctive title, so "the page does not contain it" is a real
    // assertion rather than a coincidence of short common words.
    secretTitle = 'Zzyzx-Fahrrad-mit-einzigartigem-Titel-9F3K'
    secretListingId = await seedListing(app.pg, {
      ownerId: owner.id, category: 'vehicle', title: secretTitle,
      details: { make: 'Trek', price_minor: 12345600, currency: 'EUR' },
    })
    // A second listing in a different category, so the per-category counts
    // asserted below are genuinely counting more than one thing.
    await seedListing(app.pg, { ownerId: owner.id, category: 'job' })
  })

  const fetchPage = () => app.inject({ method: 'GET', url: '/marktplatz' })
  const fetchSummary = () => app.inject({ method: 'GET', url: '/marketplace/summary' })

  it('answers 200, signed out, with no auth header at all', async () => {
    const response = await fetchPage()
    expect(response.statusCode).toBe(200)
  })

  it('names no seeded listing\'s id, title or price anywhere in the response', async () => {
    const response = await fetchPage()
    const body = response.body

    expect(body).not.toContain(secretTitle)
    expect(body).not.toContain(secretListingId)
    expect(body).not.toContain('12345600')
    expect(body).not.toContain('123456.00')
    // The owner's identity is exactly the kind of thing FR-035 forbids too.
    expect(body).not.toContain(owner.id)
  })

  it('DOES name the categories and a non-zero count — the counter-assertion', async () => {
    // Without this, an empty or listing-free page would pass the assertion
    // above for the wrong reason: because it said nothing at all.
    const response = await fetchPage()
    const body = response.body

    expect(body).toContain('Fahrzeuge')
    expect(body).toContain('Jobs')
    expect(body).toMatch(/\b2\b/) // the total across the two seeded listings
  })

  it('the JSON summary endpoint agrees, and also names no listing', async () => {
    const response = await fetchSummary()
    expect(response.statusCode).toBe(200)

    const body = response.json()
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(body.byCategory.vehicle).toBeGreaterThanOrEqual(1)
    expect(body.byCategory.job).toBeGreaterThanOrEqual(1)

    // Only two keys per category entry could ever appear — a count is not an
    // id, a title, a photo, a price or an owner.
    expect(JSON.stringify(body)).not.toContain(secretTitle)
    expect(JSON.stringify(body)).not.toContain(secretListingId)
  })

  it('is served without a credential — the summary endpoint too', async () => {
    // Both handlers in this suite are `audience: 'public'`; asserting it
    // against a real request is what actually proves it, not just the route
    // declaration.
    expect((await fetchSummary()).statusCode).toBe(200)
  })
})

describe('the two marketplace surfaces stay independent', () => {
  it('declares /marktplatz public and indexed', () => {
    const surface = surfaceByName('marketplace-discovery')
    expect(surface?.public).toBe(true)
    expect(surface?.indexed).toBe(true)
  })

  it('leaves /marketplace gated and never-indexed, UNCHANGED (FR-037)', () => {
    // The whole point of declaring two surfaces rather than one: adding the
    // public one must not have relaxed the member-only one.
    const surface = surfaceByName('marketplace')
    expect(surface?.public).toBe(false)
    expect(surface?.indexed).toBe(false)
  })

  it('disallows /marketplace in robots.txt while /marktplatz stays fetchable', () => {
    const disallowed = disallowedPrefixes()
    expect(disallowed).toContain('/marketplace')
    expect(disallowed).not.toContain('/marktplatz')
  })
})
