import { escape, renderBreadcrumbs } from './layout.js'
import { renderSections, renderShareImage, renderAddress, renderHours, renderDiscount } from './partner.js'

/**
 * An outlet is one branch of a partner (§5): same shape, its own address, hours
 * and `LocalBusiness` document, so each branch has local-search presence of its
 * own rather than competing with the parent listing.
 */
export function outletBody(record, { active = true } = {}) {
  const details = [renderAddress(record.address), renderHours(record.openingHours), renderDiscount(record.discountPercent)]
    .filter(Boolean)
    .join('\n')

  const trail = [{ name: 'Partner', path: '/partners' }]
  if (record.partner) trail.push({ name: record.partner.title, path: `/partners/${record.partner.slug}` })
  trail.push({ name: record.title, path: `/outlets/${record.slug}` })

  return [
    renderBreadcrumbs(trail),
    `<h1>${escape(record.title)}</h1>`,
    active ? '' : '<p><strong>Diese Filiale ist derzeit nicht aktiv.</strong></p>',
    `<p>${escape(record.description)}</p>`,
    renderShareImage(record.shareImage),
    details ? `<dl>\n${details}\n</dl>` : '',
    renderSections(record.sections),
  ]
    .filter(Boolean)
    .join('\n')
}

export default outletBody
