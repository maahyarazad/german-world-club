import { buildPageMeta } from '../../seo/build-page-meta.ts'
import { documentsFor } from '../../seo/structured-data.ts'
import { renderPage } from '../templates/layout.ts'
import { legalBody } from '../templates/legal.ts'
import { withCspNonces } from '../../../plugins/02-security-headers.ts'
import { escape } from '../templates/layout.ts'
import type { Viewer } from './viewer.ts'

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
// for, so it is served rather than re-rendered through a template — but not
// byte for byte: its whole stylesheet is one inline <style>, which the CSP
// refuses without this response's nonce.
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
/**
 * The labels a signed-in visitor sees (feature 022). The language is in the
 * URL — `/` is German, `/en` English — so this is the page's own copy, not a
 * response varying with `Accept-Language` (which the server never does).
 */
export const LANDING_ACCOUNT_LABELS = Object.freeze({
  de: { toConsole: 'Zur Konsole' },
  en: { toConsole: 'Go to the console' },
})

/** Replace what sits between `<!--gwc:name-->` and `<!--/gwc:name-->`, markers kept. */
function fillSlot(html: string, name: string, content: string): string {
  const open = `<!--gwc:${name}-->`
  const close = `<!--/gwc:${name}-->`
  const start = html.indexOf(open)
  const end = html.indexOf(close)
  // A shell without the marker renders as it is — the marker test is what
  // catches a lost marker, not a broken page.
  if (start < 0 || end < start) return html
  return html.slice(0, start + open.length) + content + html.slice(end)
}

/**
 * The shell for a signed-in visitor: their avatar (or initials) linking to the
 * console instead of the sign-in button, and "to the console" instead of the
 * sign-in links further down. Every value is escaped. No script is added.
 */
export function withViewer(shell: string, viewer: Viewer, language: 'de' | 'en' = 'de'): string {
  const { toConsole } = LANDING_ACCOUNT_LABELS[language] ?? LANDING_ACCOUNT_LABELS.de
  const label = viewer.name ? `${toConsole} – ${viewer.name}` : toConsole
  // The image is decorative: the link's own label already names the person.
  const face = viewer.avatar
    ? `<img src="${escape(viewer.avatar.url)}" alt="" width="40" height="40">`
    : `<span class="initials" aria-hidden="true">${escape(viewer.initials)}</span>`
  let html = fillSlot(shell, 'account', `<a class="account" href="/konsole" aria-label="${escape(label)}">${face}</a>`)
  html = fillSlot(html, 'signin', `<div class="login-actions"><a class="btn btn-primary" href="/konsole">${escape(toConsole)}</a></div>`)
  html = fillSlot(html, 'footer', `<a href="/konsole">${escape(toConsole)}</a>`)
  return html
}

export function renderLanding({ shell, record, origin, cspNonce, viewer = null, language = 'de' }: {
  shell: string | null
  // Untyped before feature 022, and still: the record is a SeoRecord and the
  // nonce the security-headers pair; typing them is not this feature's job.
  record: any
  origin: string
  cspNonce: any
  viewer?: Viewer | null
  language?: 'de' | 'en'
}) {
  // Nonces last, over the final markup. Without a viewer the shell is not
  // touched at all: an anonymous visitor gets exactly the page they always did.
  if (shell) return withCspNonces(viewer ? withViewer(shell, viewer, language) : shell, cspNonce)

  const pageMeta = buildPageMeta(record, {
    origin,
    surfaceAuth: { audience: 'public' },
    alternates: LANDING_ALTERNATES,
  })
  pageMeta.jsonLd = documentsFor(origin, record, new Date())
  return renderPage({ pageMeta, body: legalBody(record), nonce: cspNonce.style })
}
