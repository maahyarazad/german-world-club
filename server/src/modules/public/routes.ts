import fp from 'fastify-plugin'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

import { createPublicController, LANDING_ALTERNATES } from './controller.ts'
import { INSTITUTIONAL_SLUGS } from './application/landing.ts'
import type { GwcApp } from '../../app.ts'

/**
 * The six public route classes (FR-016, §10.2): schema, access posture, and
 * wiring to `controller.js` only. See `application/render-record.js` and
 * `application/landing.js` for the resolution and rendering rules.
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

export { INSTITUTIONAL_SLUGS, LANDING_ALTERNATES }

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
  async function publicRoutes(app: GwcApp) {
    const origin = app.env.canonicalOrigin
    const landingShell = await loadLandingShell(app.log, 'index.html')
    const landingShellEn = await loadLandingShell(app.log, 'en.html')

    const controller = createPublicController(app, { origin, landingShell, landingShellEn })

    const publicConfig = {
      config: { auth: { audience: 'public' }, budget: 'public-page', rateLimit: app.bucket('public-read') },
      ...htmlRoute,
    }

    // --- 1. Landing (feature 001) -------------------------------------------
    app.get('/', publicConfig, controller.landing)
    app.get('/en', publicConfig, controller.landingEn)

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
        controller.renderRecordPage(recordType),
      )
    }

    // Institutional pages live at the root, so each is declared rather than
    // served by a root-level wildcard — a wildcard here would resurrect the
    // soft-404 by answering every unknown path. Both language forms are listed
    // because §10.7's reciprocal hreflang needs both sides to be reachable.
    for (const slug of INSTITUTIONAL_SLUGS) {
      app.get(`/${slug}`, publicConfig, controller.renderRecordPage('page', slug))
    }
  },
  { name: 'public-routes', dependencies: ['rate-limit'] },
)
