import fp from 'fastify-plugin'
import { renderRobots } from './application/robots.ts'
import { renderSitemap, loadSitemapRecords } from './application/sitemap.ts'

/**
 * GET /robots.txt and GET /sitemap.xml: schema, access posture, and wiring
 * only. See `application/robots.js` and `application/sitemap.js` for the
 * generation rules.
 */
export default fp(
  async function seoPublicRoutes(app) {
    app.get(
      '/robots.txt',
      {
        config: { auth: { audience: 'public' }, produces: 'text/plain', budget: 'public-page', rateLimit: app.bucket('public-read') },
      },
      async (request, reply) =>
        reply
          .type('text/plain; charset=utf-8')
          .header('cache-control', 'public, max-age=3600')
          .send(renderRobots(app.env.canonicalOrigin)),
    )

    // Cached for an hour and invalidated on publish/unpublish, so a crawler
    // does not trigger a full content query on every fetch.
    let cache = null
    app.decorate('invalidateSitemap', () => {
      cache = null
    })

    app.get(
      '/sitemap.xml',
      {
        config: { auth: { audience: 'public' }, produces: 'application/xml', budget: 'sitemap', rateLimit: app.bucket('public-read') },
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
  { name: 'seo-public-routes', dependencies: ['db', 'rate-limit'] },
)
