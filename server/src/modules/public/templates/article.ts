import { escape, renderBreadcrumbs } from './layout.ts'
import { renderSections, renderShareImage } from './partner.ts'

/**
 * Magazine article and news (§10.1: "primary organic-traffic driver").
 *
 * The byline and dates are rendered on the page as well as emitted as JSON-LD,
 * from the same record — §10.3's rule that metadata derives from the content it
 * describes, rather than being maintained beside it.
 */

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long', timeZone: 'Asia/Dubai' })

export function renderByline(record) {
  const bits = []
  if (record.author) bits.push(`von ${escape(record.author)}`)
  if (record.publishedAt) {
    const d = new Date(record.publishedAt)
    bits.push(`<time datetime="${escape(d.toISOString())}">${escape(dateFormat.format(d))}</time>`)
  }
  return bits.length > 0 ? `<p class="byline">${bits.join(' · ')}</p>` : ''
}

export function articleBody(record) {
  return [
    renderBreadcrumbs([
      { name: 'Magazin', path: '/magazine' },
      { name: record.title, path: `/magazine/${record.slug}` },
    ]),
    `<h1>${escape(record.title)}</h1>`,
    renderByline(record),
    `<p>${escape(record.description)}</p>`,
    renderShareImage(record.shareImage),
    renderSections(record.sections),
  ]
    .filter(Boolean)
    .join('\n')
}

export default articleBody
