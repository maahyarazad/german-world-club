import fp from 'fastify-plugin'
import { disallowedPrefixes } from './surfaces.js'

/**
 * GET /robots.txt, generated from the §10.1 surface table (FR-024).
 *
 * Generated rather than static so a new gated surface is disallowed BY
 * CONSTRUCTION, not by remembering to edit a file. The static
 * client/public/robots.txt is deleted for the same reason: one source.
 */
export function renderRobots(origin) {
  const lines = ['User-agent: *']
  for (const prefix of disallowedPrefixes()) lines.push(`Disallow: ${prefix}/`)
  lines.push('')
  lines.push(`Sitemap: ${new URL('/sitemap.xml', origin).toString()}`)
  return `${lines.join('\n')}\n`
}

export default fp(
  async function robots(app) {
    app.get(
      '/robots.txt',
      {
        config: { auth: { audience: 'public' }, budget: 'public-page', rateLimit: 'public-read' },
        ...app.bucket('public-read'),
      },
      async (request, reply) =>
        reply
          .type('text/plain; charset=utf-8')
          .header('cache-control', 'public, max-age=3600')
          .send(renderRobots(app.env.canonicalOrigin)),
    )
  },
  { name: 'robots', dependencies: ['rate-limit'] },
)
