import fp from 'fastify-plugin'
import { query } from '../db/query.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

/**
 * Table-driven legacy redirects (FR-029, §12.12).
 *
 * "URL stability is an asset": indexed URLs from the previous system carry
 * accumulated search equity, and a rebuild that drops them throws that away
 * silently — the loss shows up as a ranking decline months later, with no
 * error anywhere to explain it.
 *
 * The mechanism and its tests ship now against an **empty table** (plan.md
 * Risk 5). When the club supplies its legacy URL inventory, populating it is
 * data entry rather than development. The same table also carries the 301 that
 * a slug change writes automatically (§10.8).
 *
 * The map is cached in memory because it is read on every request that would
 * otherwise 404 and changes only when staff edit a slug — which invalidates it
 * explicitly.
 */

/** Normalised the same way the table's CHECK constraint requires. */
export function normalisePath(url) {
  const [rawPath] = String(url).split('?')
  const lowered = rawPath.toLowerCase().replace(/\/{2,}/g, '/')
  return lowered.length > 1 ? lowered.replace(/\/+$/, '') || '/' : lowered
}

export default fp(
  async function legacyRedirects(app: GwcApp) {
    /** @type {Map<string, {target: string, status: number}>|null} */
    let table = null

    async function load(signal) {
      const { rows } = await query(app.pg, 'SELECT legacy_path, target_path, status FROM legacy_redirects', [], { signal })
      return new Map(rows.map((r) => [r.legacy_path, { target: r.target_path, status: r.status }]))
    }

    app.decorate('invalidateLegacyRedirects', () => {
      table = null
    })

    app.decorate('resolveLegacyRedirect', async (url, signal) => {
      if (table === null) {
        try {
          table = await load(signal)
        } catch (err) {
          // A redirect lookup must never turn a 404 into a 500.
          app.log.warn({ err }, 'legacy redirect table unavailable')
          return null
        }
      }
      return table.get(normalisePath(url)) ?? null
    })

    /**
     * Checked before routing, so a mapped path redirects even where a live
     * route of the same shape exists — the table is curated by staff, and an
     * entry in it is a deliberate statement about that URL.
     */
    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      const hit = await app.resolveLegacyRedirect(request.url, request.deadlineSignal)
      if (!hit) return

      if (hit.status === 410) {
        // Deliberately retired content: 410 tells a crawler to drop it, where a
        // 404 only suggests the URL might come back.
        throw app.httpErrors.gone('This page has been permanently retired.')
      }
      return reply
        .code(301)
        .header('location', new URL(hit.target, app.env.canonicalOrigin).toString())
        .header('cache-control', 'public, max-age=3600')
        .send()
    })
  },
  { name: 'legacy-redirects', dependencies: ['db'] },
)
