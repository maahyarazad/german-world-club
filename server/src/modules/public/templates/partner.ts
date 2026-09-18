import { escape, renderBreadcrumbs } from './layout.ts'

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

/**
 * The delivered image (FR-060, SC-018, §10.9).
 *
 * Two things are load-bearing and both are easy to drop:
 *
 *  - **Explicit `width`/`height`.** They reserve the box before any bytes
 *    arrive. §10.9 names unsized images as the most common cause of layout
 *    shift, and layout shift is scored on exactly the public pages whose
 *    ranking the club sells.
 *  - **A `srcset` across the breakpoints.** Without it a phone downloads the
 *    1600 px variant to display it at 360 px, which is most of the weight the
 *    media pipeline exists to remove.
 *
 * The `<img>` inside `<picture>` is not a fallback for "no JavaScript" — it is
 * the element that actually renders, and the one carrying the dimensions and
 * the alt text. A `<picture>` with no `<img>` displays nothing at all.
 */
export function renderShareImage(image) {
  if (!image) return ''

  const dimensions =
    `width="${escape(image.width)}" height="${escape(image.height)}"`
  const img =
    `<img src="${escape(image.url)}" ${dimensions} alt="${escape(image.alt)}" loading="lazy" decoding="async">`

  // A record whose asset has no recorded variants — a fixture, or an image
  // predating the pipeline — still renders, just without the size choice.
  if (!image.sources?.length) return img

  const sources = image.sources
    .map(
      (s) =>
        `<source type="${escape(s.type)}" srcset="${escape(s.srcset)}" ` +
        // Below the `small` breakpoint the picture spans the viewport; above it
        // the layout caps it. Without `sizes` the browser assumes 100vw and
        // picks a larger variant than it needs on a desktop.
        `sizes="(max-width: 640px) 100vw, 800px">`,
    )
    .join('\n')

  return `<picture>\n${sources}\n${img}\n</picture>`
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
