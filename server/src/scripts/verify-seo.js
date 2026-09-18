#!/usr/bin/env node
/**
 * Crawl the generated sitemap and check what a search engine would actually
 * find (§10.10, T200).
 *
 * The test suite asserts these rules against fixtures. This asserts them
 * against whatever is really in the database, which is a different and equally
 * necessary question: a resolver that is correct and a content set that is
 * wrong produce the same invisible page. Intended to run against staging after
 * a content import, and in CI against a seeded database.
 *
 *   npm run -w server verify:seo -- --origin http://localhost:3000
 *
 * Exits non-zero when any check fails, so it can gate a deploy.
 */
import { buildApp } from '../app.js'
import { loadEnv } from '../config/env.js'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}

const limit = Number(flag('limit', '500'))
const verbose = args.includes('--verbose')

const problems = []
const note = (severity, url, message) => problems.push({ severity, url, message })

/** Pull every <loc> out of the sitemap without a full XML parser. */
const locations = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])

const meta = (html, attr, value) => {
  const pattern = new RegExp(`<meta[^>]*${attr}=["']${value}["'][^>]*content=["']([^"']*)["']`, 'i')
  const reversed = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${value}["']`, 'i')
  return html.match(pattern)?.[1] ?? html.match(reversed)?.[1] ?? null
}

const canonicalOf = (html) =>
  html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i)?.[1] ?? null

const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null

async function main() {
  const env = loadEnv()
  const app = await buildApp({ env })
  await app.ready()

  /**
   * Speak as the canonical host.
   *
   * `inject` defaults to a Host of "localhost", which the canonical-origin
   * plugin correctly answers with a 301 — so without this the crawl measures
   * the redirect rather than the pages, and reports every URL as broken.
   */
  const host = new URL(env.canonicalOrigin).host
  const fetchPath = (url) => app.inject({ method: 'GET', url, headers: { host } })

  try {
    const sitemap = await fetchPath('/sitemap.xml')
    if (sitemap.statusCode !== 200) {
      note('error', '/sitemap.xml', `sitemap returned ${sitemap.statusCode}`)
      return
    }

    const urls = locations(sitemap.body).slice(0, limit)
    if (urls.length === 0) note('warn', '/sitemap.xml', 'the sitemap lists no URLs')

    // Uniqueness is checked across the whole set, not per page: a title that is
    // fine on its own but repeated across forty partner pages suppresses all
    // forty (§10.3, SC-006).
    const titles = new Map()
    const descriptions = new Map()
    const canonicals = new Map()

    for (const absolute of urls) {
      const path = new URL(absolute).pathname
      const response = await fetchPath(path)

      if (response.statusCode !== 200) {
        // A sitemap is a set of promises. Listing a URL that does not resolve
        // teaches a crawler to trust the sitemap less, across the whole site.
        note('error', path, `listed in the sitemap but returned ${response.statusCode}`)
        continue
      }

      const html = response.body
      const title = titleOf(html)
      const description = meta(html, 'name', 'description')
      const canonical = canonicalOf(html)

      if (!title) note('error', path, 'no <title>')
      if (!description) note('error', path, 'no meta description')
      if (!canonical) note('error', path, 'no canonical link')

      // Structured data must parse. An invalid JSON-LD block is worse than
      // none: the rich result silently disappears and nothing reports why.
      for (const [, block] of html.matchAll(
        /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
      )) {
        try {
          const parsed = JSON.parse(block)
          if (!parsed['@context'] || !parsed['@type']) {
            note('error', path, 'JSON-LD block is missing @context or @type')
          }
        } catch (err) {
          note('error', path, `JSON-LD does not parse: ${err.message}`)
        }
      }

      // og:image is all-or-nothing: a preview bot given a URL with no
      // dimensions renders a bare grey box (FR-018).
      const ogImage = meta(html, 'property', 'og:image')
      if (ogImage) {
        for (const field of ['og:image:width', 'og:image:height', 'og:image:alt']) {
          if (!meta(html, 'property', field)) note('error', path, `og:image without ${field}`)
        }
      }

      for (const [map, value] of [[titles, title], [descriptions, description], [canonicals, canonical]]) {
        if (value) map.set(value, [...(map.get(value) ?? []), path])
      }

      if (verbose) process.stdout.write(`  ok  ${path}\n`)
    }

    for (const [label, map] of [['title', titles], ['description', descriptions], ['canonical', canonicals]]) {
      for (const [value, paths] of map) {
        if (paths.length > 1) {
          note('error', paths.join(', '), `duplicate ${label}: ${JSON.stringify(value.slice(0, 60))}`)
        }
      }
    }

    // A URL that does not exist must say so, or it becomes a second indexable
    // copy of whatever was served instead (§10.6, FR-017).
    for (const path of ['/definitely-not-a-page', '/partners/no-such-partner']) {
      const response = await fetchPath(path)
      if (response.statusCode !== 404) note('error', path, `expected 404, got ${response.statusCode}`)
    }

    /**
     * The landing translation pair (feature 004).
     *
     * Three things go wrong here and only one of them is visible without
     * checking: canonicalising `/en` onto `/` delists the English page, a
     * one-directional hreflang suppresses both as duplicates, and negotiating
     * on `Accept-Language` makes the two URLs serve the same body.
     */
    const pair = [['/', 'de'], ['/en', 'en']]
    const pairHtml = {}

    for (const [path, language] of pair) {
      const response = await fetchPath(path)
      pairHtml[path] = response.body

      if (response.statusCode !== 200) {
        note('error', path, `landing page returned ${response.statusCode}`)
        continue
      }
      if (!response.body.includes(`<html lang="${language}">`)) {
        note('error', path, `expected <html lang="${language}">`)
      }

      /**
       * Canonical for ITSELF. Pointing at the other page delists this one.
       *
       * The PATH is what this feature can get wrong, and it is checked
       * unconditionally. The ORIGIN is baked into the static file at build
       * time, so it cannot match a development canonical origin — a mismatch
       * there is an error only in production, where the two really must agree.
       */
      const canonical = canonicalOf(response.body)
      if (canonical) {
        const declared = new URL(canonical)
        const trim = (p) => (p === '/' ? '/' : p.replace(/\/$/, ''))
        if (trim(declared.pathname) !== trim(path)) {
          note('error', path, `canonical points at ${declared.pathname}, not ${path}`)
        }
        if (declared.origin !== new URL(env.canonicalOrigin).origin) {
          note(
            env.isProduction ? 'error' : 'warn',
            path,
            `canonical origin ${declared.origin} differs from CANONICAL_ORIGIN ${env.canonicalOrigin}`,
          )
        }
      }

      // Both pages must be listed, or only one of the pair is discoverable.
      if (!urls.some((u) => new URL(u).pathname === path)) {
        note('error', path, 'missing from the sitemap')
      }

      // The URL decides the language, never the header.
      const negotiated = await app.inject({
        method: 'GET',
        url: path,
        headers: { host, 'accept-language': language === 'de' ? 'en-GB,en' : 'de-DE,de' },
      })
      if (!negotiated.body.includes(`<html lang="${language}">`)) {
        note('error', path, 'language changed with Accept-Language — the URL must decide')
      }
    }

    // Reciprocity: a one-directional hreflang is ignored and suppresses both.
    const alternatesOf = (html) =>
      [...html.matchAll(/<link[^>]+rel="alternate"[^>]*>/g)]
        .map((m) => m[0].match(/hreflang="([^"]+)"/)?.[1])
        .filter(Boolean)
        .sort()

    const de = alternatesOf(pairHtml['/'] ?? '')
    const en = alternatesOf(pairHtml['/en'] ?? '')
    if (de.length === 0) note('error', '/', 'declares no hreflang alternates')
    if (JSON.stringify(de) !== JSON.stringify(en)) {
      note('error', '/en', `hreflang is not reciprocal: / has [${de}], /en has [${en}]`)
    }
    if (!de.includes('x-default')) note('warn', '/', 'no x-default alternate')

    process.stdout.write(`\nChecked ${urls.length} URL(s) from the sitemap.\n`)
  } finally {
    await app.close()
  }
}

await main()

const errors = problems.filter((p) => p.severity === 'error')
for (const problem of problems) {
  process.stdout.write(`${problem.severity.toUpperCase().padEnd(5)} ${problem.url}: ${problem.message}\n`)
}

if (errors.length > 0) {
  process.stdout.write(`\n${errors.length} problem(s) would affect how this site is indexed.\n`)
  process.exit(1)
}

process.stdout.write('No SEO problems found.\n')
process.exit(0)
