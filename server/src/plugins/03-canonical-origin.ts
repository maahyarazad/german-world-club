import fp from 'fastify-plugin'
import { postureFor } from '../modules/seo/surfaces.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

/**
 * One origin, one URL form (FR-028, §10.6).
 *
 * Runs as an `onRequest` hook, **before routing**, so a variant never reaches a
 * handler and never produces a second indexable copy of the same page. Every
 * duplicate form — a different host, `http` instead of `https`, an upper-case
 * path, a trailing slash — splits the same content's ranking signals across
 * several URLs, and for a partner listing the club has sold that is lost
 * visibility rather than a cosmetic detail.
 *
 * The redirect is a **301**, not a 302: the alternative forms are not coming
 * back, and a temporary redirect leaves the duplicate indexed.
 */

/** Paths whose exact bytes matter and which must never be case-folded. */
const VERBATIM = [/^\/media\//i, /^\/health\//i, /^\/robots\.txt$/i, /^\/sitemap\.xml$/i]

/**
 * Query parameters that change what a public page shows.
 *
 * §10.6: "query params that do not change content are stripped from the
 * canonical." Inverting that into an allowlist is what makes it hold for
 * parameters nobody has thought of — a campaign tag, a scanner's probe, a
 * social network's click id — each of which would otherwise be a distinct
 * indexable URL carrying identical content.
 *
 * It is empty because no public surface in this feature reads a query
 * parameter. A paginated listing adds `page` here, and that addition is a
 * reviewable line in a diff.
 */
export const MEANINGFUL_PARAMS = Object.freeze([])

/**
 * `http://example.com:80/` and `http://example.com/` are the same URL, so the
 * default port is stripped before comparing. Treating them as different would
 * make every request from a client that spells the port out a redirect.
 */
export function normaliseHost(host, protocol) {
  if (!host) return host
  const lowered = String(host).toLowerCase()
  const defaultPort = protocol === 'https' ? ':443' : ':80'
  return lowered.endsWith(defaultPort) ? lowered.slice(0, -defaultPort.length) : lowered
}

/** @returns {string|null} the canonical URL when this request is a variant, else null */
export function canonicalise(requestUrl, { host, protocol }, canonicalOrigin) {
  const canonical = new URL(canonicalOrigin)
  const [rawPath, rawQuery = ''] = String(requestUrl).split('?')

  let pathname = rawPath
  if (!VERBATIM.some((re) => re.test(pathname))) {
    pathname = pathname.toLowerCase()
  }
  // One trailing-slash convention: no trailing slash, except the root itself.
  pathname = pathname.replace(/\/{2,}/g, '/')
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '') || '/'

  const params = new URLSearchParams(rawQuery)
  for (const key of [...params.keys()]) {
    if (!MEANINGFUL_PARAMS.includes(key)) params.delete(key)
  }
  const query = params.toString()

  const hostMismatch =
    host !== undefined && normaliseHost(host, protocol) !== normaliseHost(canonical.host, canonical.protocol.slice(0, -1))
  const schemeMismatch = protocol !== undefined && `${protocol}:` !== canonical.protocol
  const pathMismatch = pathname !== rawPath
  const queryMismatch = query !== rawQuery

  if (!hostMismatch && !schemeMismatch && !pathMismatch && !queryMismatch) return null

  return `${canonical.origin}${pathname}${query ? `?${query}` : ''}`
}

export default fp(
  async function canonicalOrigin(app: GwcApp) {
    const origin = app.env.canonicalOrigin

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      /**
       * Only safe methods are canonicalised. A 301 on a POST is a real hazard:
       * clients differ on whether they re-send the body, so a redirected
       * sign-in or upload can silently become a GET with nothing in it.
       */
      if (request.method !== 'GET' && request.method !== 'HEAD') return

      // Health must answer on whatever host the probe used; redirecting a
      // liveness probe would break it.
      if (request.url.startsWith('/health/')) return

      // Gated surfaces are machine and member interfaces, not indexable
      // content, so there is nothing to canonicalise and a redirect would only
      // add a round trip. `/api` and `/auth` are gated in surfaces.js.
      if (!postureFor(undefined, request.url).public) return

      const target = canonicalise(request.url, { host: request.headers.host, protocol: request.protocol }, origin)
      if (!target) return

      return reply
        .code(301)
        .header('location', target)
        .header('cache-control', 'public, max-age=3600')
        .send()
    })
  },
  { name: 'canonical-origin' },
)
