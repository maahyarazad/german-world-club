import fp from 'fastify-plugin'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { buildPageMeta } from '../seo/build-page-meta.js'
import { documentsFor, isContractLive } from '../seo/structured-data.js'
import { renderPage } from './templates/layout.js'
import { partnerBody } from './templates/partner.js'
import { outletBody } from './templates/outlet.js'
import { eventBody } from './templates/event.js'
import { articleBody } from './templates/article.js'
import { legalBody } from './templates/legal.js'

/**
 * The six public route classes (FR-016, §10.2).
 *
 * Every one of them resolves its record, calls the single metadata resolver,
 * renders a server-side template, and returns **real content in the first
 * response**. §10.2 makes that a constraint rather than a preference: link
 * preview bots and most non-Google crawlers execute no JavaScript, so a
 * client-only strategy silently costs the club its share links and the partner
 * visibility it has sold.
 *
 * A slug that resolves to no record returns a real 404 (FR-017). Nothing here
 * falls back to the application shell — that fallback is the §12.13 defect this
 * feature exists to remove.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.resolve(HERE, '..', '..', '..', 'client')

/** Public content caching, per seo-delivery.md §8. */
const PUBLIC_CACHE = 'public, max-age=300, stale-while-revalidate=86400'

/**
 * `Vary: Accept-Language` is load-bearing with §10.7's multilingual pages:
 * without it a shared cache can serve the German page to an English request.
 */
const VARY = 'Accept-Encoding, Accept-Language'

/**
 * HTML routes still declare an explicit response schema (Constitution
 * Principle VI), but must not be JSON-serialized on the way out — so the
 * schema documents the route while a pass-through serializer preserves the
 * bytes.
 */
const htmlRoute = {
  schema: {
    response: {
      200: z.string().describe('Server-rendered HTML'),
      404: z.string().describe('Rendered, non-indexable not-found page'),
    },
  },
  // Rendered HTML passes through untouched. Anything else on these routes is
  // the error handler's problem+json object, which still needs serializing —
  // returning it as-is would turn every API-shaped 404 into a 500.
  serializerCompiler: () => (payload) => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
}

/**
 * Root-level institutional pages (§10.1 "committee / about / legal"). Adding
 * one is a deliberate act: a record whose slug is not listed here has no public
 * URL, which is the opposite of a wildcard that invents one for every path.
 */
export const INSTITUTIONAL_SLUGS = Object.freeze([
  'about', 'about-us', 'legal', 'imprint', 'impressum', 'privacy', 'datenschutz',
])

const BODIES = {
  partner: partnerBody,
  outlet: outletBody,
  event: eventBody,
  article: articleBody,
  committee: legalBody,
  page: legalBody,
}

/** Read one landing document once, preferring a production build. */
async function loadLandingShell(log, file = 'index.html') {
  for (const candidate of [path.join(CLIENT_DIR, 'dist', file), path.join(CLIENT_DIR, file)]) {
    try {
      return await readFile(candidate, 'utf8')
    } catch {
      // Try the next candidate; the absence of a build is normal in development.
    }
  }
  log?.warn({ file }, 'no client shell found — this landing route will render the fallback page')
  return null
}

export default fp(
  async function publicRoutes(app) {
    const origin = app.env.canonicalOrigin
    const landingShell = await loadLandingShell(app.log, 'index.html')
    const landingShellEn = await loadLandingShell(app.log, 'en.html')

    /**
     * Render one record, or throw a real 404.
     *
     * `disposition` is FR-031: a partner past its contract plus grace is, by
     * default, **retained but not indexed** — the page keeps working for anyone
     * holding the link while the listing stops being advertised, which is what
     * the sponsor stopped paying for.
     */
    async function renderRecord(request, reply, recordType, slug) {
      const now = new Date()
      const record = await app.contentSource.find(recordType, slug, { signal: request.deadlineSignal })
      if (!record) throw app.httpErrors.notFound('No such page.')

      // An unpublished record is not a page yet: it 404s rather than leaking a
      // draft, and that is indistinguishable from "never existed" by design.
      if (!record.published) throw app.httpErrors.notFound('No such page.')

      const active = recordType === 'partner' || recordType === 'outlet' ? isContractLive(record, now) : true

      const alternates = await app.contentSource.alternates(record, { signal: request.deadlineSignal })
      const pageMeta = buildPageMeta(
        // A lapsed listing stops being indexable without a staff action.
        { ...record, indexable: record.indexable && active },
        { origin, alternates, surfaceAuth: { audience: 'public' } },
      )
      pageMeta.jsonLd = documentsFor(origin, record, now)

      const body = (BODIES[recordType] ?? legalBody)(record, { active, now })

      return reply
        .code(200)
        .type('text/html; charset=utf-8')
        .header('cache-control', PUBLIC_CACHE)
        .header('vary', VARY)
        .header('content-language', pageMeta.lang)
        .send(renderPage({ pageMeta, body, nonce: reply.cspNonce?.style }))
    }

    const publicConfig = {
      config: { auth: { audience: 'public' }, budget: 'public-page', rateLimit: app.bucket('public-read') },
      ...htmlRoute,
    }

    // --- 1. Landing (feature 001) -------------------------------------------
    // The coming-soon shell is already pre-rendered: its boot markup paints a
    // branded first screen from HTML alone, which is exactly what FR-016 asks
    // for, so it is served as-is rather than re-rendered through a template.
    const LANDING_RECORD = Object.freeze({
      recordType: 'page', recordId: 'landing', slug: 'home',
      title: 'German World Club — Ein globales Vertrauensnetz',
      description:
        'Ein globales Netzwerk für deutschsprachige Menschen mit internationalem Leben: reale '
        + 'Beziehungen, geprüfte Experten, Veranstaltungen, lokale Vorteile und globale Kontinuität.',
      language: 'de', indexable: true, published: true, sections: [],
    })

    /**
     * The English landing page.
     *
     * `slug: 'en'` rather than a new routing concept: `pathFor` already maps a
     * `page` record to `/${slug}`, so this resolves to `/en` with no change to
     * it — the same way `about-us` and `imprint` already work.
     */
    const LANDING_RECORD_EN = Object.freeze({
      recordType: 'page', recordId: 'landing-en', slug: 'en',
      title: 'German World Club — A Global Network of Trust',
      description:
        'A global network for German-speaking people with international lives: real relationships, '
        + 'verified experts, events, local benefits and continuity across borders.',
      language: 'en', indexable: true, published: true, sections: [],
    })

    /**
     * The alternates for the pair.
     *
     * Written once and handed to both routes, so neither page can name the
     * other without the other naming it back. A one-directional hreflang is
     * ignored by search engines and leaves the two competing as duplicates —
     * deriving the set from one place makes that inexpressible rather than
     * merely discouraged.
     */
    const LANDING_ALTERNATES = Object.freeze([
      { language: 'de', slug: 'home', recordType: 'page' },
      { language: 'en', slug: 'en', recordType: 'page' },
    ])

    /**
     * One handler shape for both languages.
     *
     * The URL decides the language — never `Accept-Language`. Two URLs that can
     * serve the same body compete as duplicates, cache badly, and answer a
     * crawler differently from a visitor.
     */
    const landingHandler = (shell, record) => async (request, reply) => {
      reply
        .type('text/html; charset=utf-8')
        .header('cache-control', PUBLIC_CACHE)
        .header('vary', VARY)

      if (shell) return reply.send(shell)

      // No client build present. Rather than serve nothing, render the same
      // content through the normal path — so even this fallback satisfies
      // FR-016 instead of shipping an empty shell.
      const pageMeta = buildPageMeta(record, {
        origin,
        surfaceAuth: { audience: 'public' },
        alternates: LANDING_ALTERNATES,
      })
      pageMeta.jsonLd = documentsFor(origin, record, new Date())
      return reply.send(renderPage({ pageMeta, body: legalBody(record), nonce: reply.cspNonce?.style }))
    }

    app.get('/', publicConfig, landingHandler(landingShell, LANDING_RECORD))
    app.get('/en', publicConfig, landingHandler(landingShellEn, LANDING_RECORD_EN))

    // --- 2..6. Record-backed surfaces ---------------------------------------
    const slugParams = {
      params: z.object({ slug: z.string().min(1).max(200) }),
    }

    for (const [prefix, recordType] of [
      ['/partners', 'partner'],
      ['/outlets', 'outlet'],
      ['/events', 'event'],
      ['/magazine', 'article'],
      ['/committees', 'committee'],
    ]) {
      app.get(
        `${prefix}/:slug`,
        { ...publicConfig, schema: { ...htmlRoute.schema, ...slugParams } },
        (request, reply) => renderRecord(request, reply, recordType, request.params.slug),
      )
    }

    // Institutional pages live at the root, so each is declared rather than
    // served by a root-level wildcard — a wildcard here would resurrect the
    // soft-404 by answering every unknown path. Both language forms are listed
    // because §10.7's reciprocal hreflang needs both sides to be reachable.
    for (const slug of INSTITUTIONAL_SLUGS) {
      app.get(`/${slug}`, publicConfig, (request, reply) => renderRecord(request, reply, 'page', slug))
    }
  },
  { name: 'public-routes', dependencies: ['rate-limit'] },
)
