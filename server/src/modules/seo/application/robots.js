import { disallowedPrefixes } from '../surfaces.js'

/**
 * The body of GET /robots.txt, generated from the §10.1 surface table
 * (FR-024).
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
