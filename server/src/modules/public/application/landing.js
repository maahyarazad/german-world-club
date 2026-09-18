import { buildPageMeta } from '../../seo/build-page-meta.js'
import { documentsFor } from '../../seo/structured-data.js'
import { renderPage } from '../templates/layout.js'
import { legalBody } from '../templates/legal.js'

/**
 * Root-level institutional pages (§10.1 "committee / about / legal"). Adding
 * one is a deliberate act: a record whose slug is not listed here has no
 * public URL, which is the opposite of a wildcard that invents one for every
 * path.
 */
export const INSTITUTIONAL_SLUGS = Object.freeze([
  'about', 'about-us', 'legal', 'imprint', 'impressum', 'privacy', 'datenschutz',
])

// --- 1. Landing (feature 001) -------------------------------------------
// The coming-soon shell is already pre-rendered: its boot markup paints a
// branded first screen from HTML alone, which is exactly what FR-016 asks
// for, so it is served as-is rather than re-rendered through a template.
export const LANDING_RECORD = Object.freeze({
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
export const LANDING_RECORD_EN = Object.freeze({
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
 * Written once and handed to both routes, so neither page can name the other
 * without the other naming it back. A one-directional hreflang is ignored by
 * search engines and leaves the two competing as duplicates — deriving the
 * set from one place makes that inexpressible rather than merely discouraged.
 */
export const LANDING_ALTERNATES = Object.freeze([
  { language: 'de', slug: 'home', recordType: 'page' },
  { language: 'en', slug: 'en', recordType: 'page' },
])

/**
 * The URL decides the language — never `Accept-Language`. Two URLs that can
 * serve the same body compete as duplicates, cache badly, and answer a
 * crawler differently from a visitor.
 *
 * When no client build is present, rather than serve nothing, this renders
 * the same content through the normal path — so even this fallback satisfies
 * FR-016 instead of shipping an empty shell.
 */
export function renderLanding({ shell, record, origin, nonce }) {
  if (shell) return shell

  const pageMeta = buildPageMeta(record, {
    origin,
    surfaceAuth: { audience: 'public' },
    alternates: LANDING_ALTERNATES,
  })
  pageMeta.jsonLd = documentsFor(origin, record, new Date())
  return renderPage({ pageMeta, body: legalBody(record), nonce })
}
