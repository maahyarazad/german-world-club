import { escape, renderBreadcrumbs } from './layout.js'

/**
 * Partner listing body (§5, §10.5).
 *
 * Partner visibility is a paid deliverable, so this is the template whose
 * content correctness is revenue-bearing: address, hours and the member
 * discount must appear in the first response, with no JavaScript, or the
 * preview bots and non-Google crawlers see an empty page.
 *
 * A lapsed listing is still rendered — it is marked inactive and left
 * non-indexed rather than deleted, which is FR-031's default disposition.
 */

export function renderSections(sections = []) {
  return sections
    .map((s) => `<h2>${escape(s.heading)}</h2>\n<p>${escape(s.body)}</p>`)
    .join('\n')
}

export function renderShareImage(image) {
  if (!image) return ''
  // Explicit width/height reserve the box before the bytes arrive — §10.9 names
  // unsized images as the most common cause of layout shift.
  return `<img src="${escape(image.url)}" width="${escape(image.width)}" height="${escape(image.height)}" alt="${escape(image.alt)}" loading="lazy">`
}

export function renderAddress(address) {
  if (!address) return ''
  const parts = [address.street, address.city, address.country].filter(Boolean)
  return `<dt>Adresse</dt><dd>${escape(parts.join(', '))}</dd>`
}

export function renderHours(openingHours) {
  if (!openingHours) return ''
  const value = Array.isArray(openingHours) ? openingHours.join('; ') : openingHours
  return `<dt>Öffnungszeiten</dt><dd>${escape(value)}</dd>`
}

export function renderDiscount(percent) {
  if (!percent) return ''
  return `<dt>Mitgliederrabatt</dt><dd>${escape(percent)} %</dd>`
}

export function partnerBody(record, { active = true } = {}) {
  const details = [renderAddress(record.address), renderHours(record.openingHours), renderDiscount(record.discountPercent)]
    .filter(Boolean)
    .join('\n')

  return [
    renderBreadcrumbs([{ name: 'Partner', path: '/partners' }, { name: record.title, path: `/partners/${record.slug}` }]),
    `<h1>${escape(record.title)}</h1>`,
    active ? '' : '<p><strong>Diese Partnerschaft ist derzeit nicht aktiv.</strong></p>',
    `<p>${escape(record.description)}</p>`,
    renderShareImage(record.shareImage),
    details ? `<dl>\n${details}\n</dl>` : '',
    renderSections(record.sections),
  ]
    .filter(Boolean)
    .join('\n')
}

export default partnerBody
