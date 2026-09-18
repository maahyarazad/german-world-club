import { escape, renderBreadcrumbs } from './layout.ts'
import { renderSections } from './partner.ts'

/**
 * Institutional pages — committees, about, imprint, legal (§10.1
 * "institutional credibility").
 *
 * The plainest template in the set, and the one most likely to be the first
 * result for a search on the club's own name, so it still carries a real h1,
 * a real description and its breadcrumb trail rather than a bare shell.
 */

const TRAILS = {
  committee: { name: 'Komitees', path: '/committees' },
  page: { name: 'Über uns', path: '/about' },
}

export function legalBody(record) {
  const parent = TRAILS[record.recordType]
  const trail = parent ? [parent, { name: record.title, path: `/${record.slug}` }] : []

  return [
    renderBreadcrumbs(trail),
    `<h1>${escape(record.title)}</h1>`,
    `<p>${escape(record.description)}</p>`,
    renderSections(record.sections),
  ]
    .filter(Boolean)
    .join('\n')
}

export default legalBody
