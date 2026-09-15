import fp from 'fastify-plugin'
import { query } from '../db/query.js'
import { absolute, pathFor } from './build-page-meta.js'
import { isContractLive } from './structured-data.js'
import { postureFor } from './surfaces.js'

/**
 * GET /sitemap.xml, generated from a live query (FR-023, §10.5).
 *
 * §10.5 requires entries to "appear when content is published and disappear
 * when it is unpublished, expires, or (for partners) when the listing contract
 * lapses" — so the query is the source of truth, not a staff action. A
 * hand-maintained file fails this on the first missed edit, and a partner still
 * listed after their contract lapsed is, as §10.4 puts it, "a factual
 * misstatement to members".
 *
 * `<lastmod>` is each record's real updated_at, never the build time.
 */

const SITEMAP_INDEX_THRESHOLD = 10_000

/**
 * The inclusion predicate, as one function so the rule lives in one place.
 *
 * `contractGuard` is injected because partner contract data belongs to the
 * partners feature. Until it exists the guard defaults to "no contract data →
 * include", and the lapse behaviour is proved by injecting a guard in tests.
 */
export function shouldInclude(record, { now = new Date(), contractGuard = isContractLive } = {}) {
  if (!record.published) return false
  if (!record.indexable) return false
  const path = pathFor(record.recordType, record.slug)
  if (!postureFor({ audience: 'public' }, path).indexed) return false
  if (record.recordType === 'partner' || record.recordType === 'outlet') {
    if (!contractGuard(record, now)) return false
  }
  return true
}

const escapeXml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])

export function renderSitemap(origin, records, options = {}) {
  const included = records.filter((r) => shouldInclude(r, options))
  const urls = included.map((r) => {
    const loc = escapeXml(absolute(origin, pathFor(r.recordType, r.slug)))
    const lastmod = r.updatedAt ? new Date(r.updatedAt).toISOString() : null
    return `  <url>\n    <loc>${loc}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`
  })
  return {
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
    count: included.length,
    needsIndex: included.length > SITEMAP_INDEX_THRESHOLD,
  }
}

export async function loadSitemapRecords(pool, signal) {
  const { rows } = await query(
    pool,
    `SELECT record_type, record_id, slug, indexable, published, updated_at
       FROM seo_metadata
      WHERE published = true AND indexable = true
      ORDER BY updated_at DESC`,
    [],
    { signal },
  )
  return rows.map((r) => ({
    recordType: r.record_type,
    recordId: r.record_id,
    slug: r.slug,
    indexable: r.indexable,
    published: r.published,
    updatedAt: r.updated_at,
  }))
}

export default fp(
  async function sitemap(app) {
    // Cached for an hour and invalidated on publish/unpublish, so a crawler
    // does not trigger a full content query on every fetch.
    let cache = null
    app.decorate('invalidateSitemap', () => {
      cache = null
    })

    app.get(
      '/sitemap.xml',
      {
        config: { auth: { audience: 'public' }, budget: 'sitemap', rateLimit: 'public-read' },
        ...app.bucket('public-read'),
      },
      async (request, reply) => {
        if (!cache || Date.now() - cache.at > 3_600_000) {
          const records = await loadSitemapRecords(app.pg, request.deadlineSignal)
          const { xml, count, needsIndex } = renderSitemap(app.env.canonicalOrigin, records)
          if (needsIndex) {
            request.log.warn({ count }, 'sitemap exceeds 10,000 URLs — a sitemap index is now required')
          }
          cache = { xml, at: Date.now() }
        }
        return reply
          .type('application/xml; charset=utf-8')
          .header('cache-control', 'public, max-age=3600')
          .send(cache.xml)
      },
    )
  },
  { name: 'sitemap', dependencies: ['db', 'rate-limit'] },
)
