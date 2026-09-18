import { escape, renderBreadcrumbs } from './layout.js'
import { renderSections, renderShareImage } from './partner.js'

/**
 * Public event page (§4, §10.1).
 *
 * Deliberately separate from the registration flow: the *page* is public and
 * indexed, the *registration* is member-only and never indexed. §10.1 keeps
 * `/events/:slug` public and `/events/:slug/register` gated, and mixing the two
 * templates is how a checkout surface ends up in an index.
 *
 * Nothing member-only appears here — not even a teaser. FR-026 forbids partial
 * rendering of gated content to an unauthenticated visitor, because a teaser
 * contradicts the invite-only model that defines the club.
 */

const dateFormat = new Intl.DateTimeFormat('de-DE', {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'Asia/Dubai',
})

export function renderWhen(record) {
  if (!record.startsAt) return ''
  const starts = new Date(record.startsAt)
  return `<dt>Termin</dt><dd><time datetime="${escape(starts.toISOString())}">${escape(dateFormat.format(starts))}</time></dd>`
}

export function renderVenue(venue) {
  if (!venue) return ''
  const value = [venue.name, venue.address].filter(Boolean).join(', ')
  return `<dt>Ort</dt><dd>${escape(value)}</dd>`
}

/**
 * The on-page statement of registration state, computed from the same live
 * window and capacity the JSON-LD uses — so the page and the structured data
 * can never disagree (§10.4).
 */
export function renderRegistrationState(record, now = new Date()) {
  const closes = record.registrationClosesAt ? new Date(record.registrationClosesAt) : null
  const opens = record.registrationOpensAt ? new Date(record.registrationOpensAt) : null
  const capacity = Number(record.capacity ?? 0)
  const taken = Number(record.registeredCount ?? 0)

  let text = 'Anmeldung geöffnet'
  if (closes && now > closes) text = 'Anmeldung geschlossen'
  else if (capacity > 0 && taken >= capacity) text = 'Ausgebucht'
  else if (opens && now < opens) text = 'Anmeldung noch nicht geöffnet'

  return `<dt>Anmeldung</dt><dd>${escape(text)}</dd>`
}

export function eventBody(record, { now = new Date() } = {}) {
  const details = [renderWhen(record), renderVenue(record.venue), renderRegistrationState(record, now)]
    .filter(Boolean)
    .join('\n')

  return [
    renderBreadcrumbs([
      { name: 'Veranstaltungen', path: '/events' },
      { name: record.title, path: `/events/${record.slug}` },
    ]),
    `<h1>${escape(record.title)}</h1>`,
    `<p>${escape(record.description)}</p>`,
    renderShareImage(record.shareImage),
    details ? `<dl>\n${details}\n</dl>` : '',
    renderSections(record.sections),
  ]
    .filter(Boolean)
    .join('\n')
}

export default eventBody
