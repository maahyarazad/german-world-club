import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../../src/app.ts'
import { buildFixtureApp, RECORDS } from '../helpers/fixtures.ts'
import { renderSitemap } from '../../src/modules/seo/application/sitemap.ts'
import { surfaceByName, disallowedPrefixes } from '../../src/modules/seo/surfaces.ts'
import type { GwcApp } from '../../src/app.ts'
import type { InjectOptions } from 'light-my-request'

type InjectMethod = NonNullable<InjectOptions['method']>

/**
 * The marketplace's access posture (US2, FR-038, Principle II).
 *
 * §7's marketplace is member-only. It is also the first feature whose *content*
 * a search engine would happily index if given the chance — classifieds are
 * exactly the kind of page that ranks — which makes both halves worth asserting
 * together: refused without a bearer, and marked `noindex` when served with one.
 */

/**
 * One app for the whole file. Two would be clearer to read and impossible to
 * run: `ops/jobs.ts` registers named cron jobs, and a second app in the same
 * process fails on the duplicate name. The fixture app is the one with a
 * content source, which the crawl routes need — an app with no pages answers
 * a redirect, and a redirect contains no marketplace URL for trivial reasons.
 */
let app: GwcApp
beforeAll(async () => { app = await buildFixtureApp() })
afterAll(async () => { await app.close() })

/**
 * Every GATED marketplace route, read from the real route table rather than a
 * list.
 *
 * `/marketplace/summary` is excluded on purpose: it is public by design (US7,
 * FR-034) — aggregate counts only, never a listing — and is asserted
 * separately in `tests/seo/marketplace-public.test.ts`. A blanket "every
 * marketplace route requires a bearer" would be exactly the check that
 * regresses the day someone adds the next public route here without reading
 * this comment, so the exclusion is named rather than silent.
 */
const marketplaceRoutes = () =>
  app.routePostures().filter((r) => r.url.startsWith('/marketplace') && r.url !== '/marketplace/summary')

describe('every marketplace route', () => {
  it('has routes to check at all', () => {
    // Without this the suite below would pass vacuously against a server that
    // registered no marketplace routes whatsoever.
    expect(marketplaceRoutes().length).toBeGreaterThan(0)
  })

  it('declares the member audience, never public', () => {
    for (const route of marketplaceRoutes()) {
      expect(route.auth?.audience, `${route.method} ${route.url}`).toBe('member')
    }
  })

  it('is refused without a bearer', async () => {
    for (const route of marketplaceRoutes()) {
      // `inject` takes light-my-request's own HTTPMethods, which is a
      // distinct type identity from Fastify's despite the identical name.
      const method = (Array.isArray(route.method) ? route.method[0] : route.method) as InjectMethod
      const url = route.url
        .replace(':assetId', '00000000-0000-0000-0000-000000000000')
        .replace(':id', '00000000-0000-0000-0000-000000000000')

      const response = await app.inject({ method, url, payload: {} })
      
      // 401, not 404: the surface exists and says so. Hiding it would be
      // security through obscurity, and the row-level 404s elsewhere in this
      // feature are about not confirming which *ids* exist, not which routes do.
      expect(response.statusCode, `${method} ${url}`).toBe(401)
    }
  })

  it('carries X-Robots-Tag: noindex on an unauthenticated refusal', async () => {
    const response = await app.inject({ method: 'GET', url: '/marketplace/listings' })
    expect(response.headers['x-robots-tag']).toMatch(/noindex/)
  })

  it('the ONE excluded route really is public, not merely un-swept', async () => {
    // The counter-assertion for the exclusion above: without this, silently
    // narrowing marketplaceRoutes() could hide a route that regressed to
    // gated-but-forgotten just as easily as it hides a genuinely public one.
    const route = app.routePostures().find((r) => r.url === '/marketplace/summary')
    expect(route?.auth?.audience).toBe('public')

    const response = await app.inject({ method: 'GET', url: '/marketplace/summary' })
    expect(response.statusCode).toBe(200)
  })
})

describe('the marketplace surface declaration', () => {
  it('is gated and not indexed', () => {
    const surface = surfaceByName('marketplace')
    expect(surface?.public).toBe(false)
    expect(surface?.indexed).toBe(false)
  })

  it('is disallowed in robots.txt', () => {
    // Gated, so Disallow is the right instrument: it stops the fetch rather
    // than merely stopping the listing.
    expect(disallowedPrefixes()).toContain('/marketplace')
  })

  it('STILL leaves the public pages indexable', () => {
    // Counter-assertion: a surfaces table that had started answering "gated"
    // to everything would pass both tests above and delist the whole site.
    expect(disallowedPrefixes()).not.toContain('/')
  })
})

describe('the crawl surface', () => {
  /**
   * Rendered over the real fixture corpus rather than read off the served
   * route. The served sitemap is built from SQL, and against an empty database
   * it is an empty `<urlset>` — which contains no marketplace URL for reasons
   * that have nothing to do with the marketplace. Rendering a populated corpus
   * is what makes the absence mean something.
   */
  const ORIGIN = 'https://german-world-club.test'
  const locsOf = (xml: string) =>
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc ?? '')

  it('lists no marketplace URL in the sitemap', async () => {
    const { xml } = renderSitemap(ORIGIN, RECORDS, { now: new Date('2026-06-01') })
    const locs = locsOf(xml)

    // Counter-assertion first: an empty sitemap would satisfy the real
    // assertion below and delist the entire site.
    expect(locs.length).toBeGreaterThan(0)

    // A classifieds listing is exactly the kind of page that ranks, which is
    // why this is checked apart from the posture: a route can be correctly
    // gated and still be advertised to every crawler by a sitemap built from
    // a different source.
    expect(locs.filter((loc) => loc.includes('/marketplace'))).toEqual([])
  })

  it('serves the sitemap route at all', async () => {
    const response = await app.inject({ method: 'GET', url: '/sitemap.xml' })
    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<urlset')
  })

  it('disallows /marketplace in robots.txt', async () => {
    const response = await app.inject({ method: 'GET', url: '/robots.txt' })
    expect(response.body).toContain('Disallow: /marketplace')
  })
})

describe('the boot gate still covers these routes', () => {
  it('REFUSES TO BOOT when a marketplace route drops config.auth', async () => {
    // The gate is what makes the assertions above durable: they check the
    // routes as written today, this checks that a route written tomorrow
    // without a posture cannot reach review.
    const bare = await buildApp()
    bare.get('/marketplace/listings/featured', {
      schema: { response: { 200: z.object({ ok: z.boolean() }) } },
    }, async () => ({ ok: true }))

    await expect(bare.ready()).rejects.toThrow(/no config\.auth declared/)
    await bare.close().catch(() => {})
  })
})
