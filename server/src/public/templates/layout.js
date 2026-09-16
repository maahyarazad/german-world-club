/**
 * The one HTML serializer for public pages.
 *
 * `buildPageMeta` decides *what* the head says; this decides how it is written.
 * Splitting them is what keeps the resolver pure and unit-testable, and it is
 * why there are no hand-written OG tags anywhere else in the codebase.
 *
 * Every interpolation goes through `escape`. A partner business name containing
 * a double quote would otherwise break out of `content="…"` — which is both a
 * broken share preview and an injection point on a page the club sells.
 */

export const escape = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c])

/** JSON-LD needs `<` and `&` neutralised so a payload cannot close the script. */
const jsonLdSafe = (doc) =>
  JSON.stringify(doc).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

const meta = (attr, key, value) =>
  value == null || value === '' ? '' : `<meta ${attr}="${escape(key)}" content="${escape(value)}">`

export function renderHead(pageMeta, { nonce } = {}) {
  const m = pageMeta
  const lines = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(m.title)}</title>`,
    meta('name', 'description', m.description),
    meta('name', 'robots', m.robots),
    `<link rel="canonical" href="${escape(m.canonical)}">`,
  ]

  // Reciprocal alternates, including x-default (FR-030).
  for (const alt of m.alternates ?? []) {
    lines.push(`<link rel="alternate" hreflang="${escape(alt.hreflang)}" href="${escape(alt.href)}">`)
  }

  lines.push(
    meta('property', 'og:type', m.og.type),
    meta('property', 'og:site_name', m.og.siteName),
    meta('property', 'og:title', m.og.title),
    meta('property', 'og:description', m.og.description),
    meta('property', 'og:url', m.og.url),
    meta('property', 'og:locale', m.og.locale),
  )

  // All four image fields together or none at all — a preview bot given a URL
  // with no dimensions renders a broken card (FR-018, §10.9).
  if (m.og.image) {
    lines.push(
      meta('property', 'og:image', m.og.image.url),
      meta('property', 'og:image:width', m.og.image.width),
      meta('property', 'og:image:height', m.og.image.height),
      meta('property', 'og:image:alt', m.og.image.alt),
    )
  }

  lines.push(
    meta('name', 'twitter:card', m.twitter.card),
    meta('name', 'twitter:title', m.twitter.title),
    meta('name', 'twitter:description', m.twitter.description),
    meta('name', 'twitter:image', m.twitter.image),
  )

  for (const doc of m.jsonLd ?? []) {
    lines.push(`<script type="application/ld+json">${jsonLdSafe(doc)}</script>`)
  }

  lines.push(`<style${nonce ? ` nonce="${escape(nonce)}"` : ''}>${CRITICAL_CSS}</style>`)

  return lines.filter(Boolean).join('\n')
}

/**
 * Inline critical CSS: the page must be legible in the first response, before
 * any stylesheet arrives. The CSP nonce above is what permits it — the reason
 * `enableCSPNonces` is on in the security-headers plugin.
 */
const CRITICAL_CSS = `
:root{color-scheme:dark;--ink:#fff8f0;--muted:#f0d8d4;--gold:#c9a227}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(180deg,#750a04 0%,#4a0603 58%,#1a0b0a 100%);
color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
line-height:1.65}
main{max-width:64rem;margin:0 auto;padding:clamp(1.5rem,5vw,4rem)}
h1{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:clamp(1.9rem,5vw,3rem);margin:0 0 .5rem}
h2{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:clamp(1.2rem,3vw,1.6rem);margin:2rem 0 .5rem}
p{color:var(--muted);margin:.75rem 0}
a{color:var(--gold)}
img{max-width:100%;height:auto}
dl{display:grid;grid-template-columns:auto 1fr;gap:.35rem 1rem;margin:1rem 0}
dt{color:var(--gold)}
dd{margin:0;color:var(--muted)}
nav.crumbs{font-size:.85rem;margin-bottom:1rem}
`.trim()

/** Breadcrumb trail, rendered as real links so the JSON-LD has an on-page peer. */
export function renderBreadcrumbs(trail = []) {
  if (trail.length === 0) return ''
  const items = trail.map((t) => `<a href="${escape(t.path)}">${escape(t.name)}</a>`)
  return `<nav class="crumbs" aria-label="Brotkrumen">${items.join(' / ')}</nav>`
}

/**
 * The full document. `body` is already-escaped HTML produced by a per-type
 * template; everything else is escaped here.
 */
export function renderPage({ pageMeta, body, nonce }) {
  return `<!doctype html>
<html lang="${escape(pageMeta.lang)}">
<head>
${renderHead(pageMeta, { nonce })}
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
}
