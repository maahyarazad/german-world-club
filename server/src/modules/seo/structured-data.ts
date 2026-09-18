import { SITE_NAME } from '@gwc/contracts/seo'
import { absolute, pathFor } from './build-page-meta.ts'
import type { SeoRecord } from './types.ts'

/**
 * JSON-LD, generated per request from live state (FR-022, §12.14).
 *
 * §10.4 is unambiguous: "publishing an Event as available after registration
 * has closed, or a partner as active after their contract lapsed, is both an
 * SEO penalty and a factual misstatement to members."
 *
 * So nothing here is cached or denormalised. Every document is derived from the
 * record handed in, and the availability/active decisions are computed from
 * timestamps at call time.
 */

export function organization(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: origin,
    areaServed: ['AE', 'DE'],
  }
}

export function breadcrumbs(origin: string, trail: readonly { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((t: { name: string; path: string }, i: number) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: t.name,
      item: absolute(origin, t.path),
    })),
  }
}

export function article(origin: string, record: SeoRecord) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: record.seoTitle?.trim() || record.title,
    description: record.metaDescription?.trim() || record.description,
    mainEntityOfPage: absolute(origin, pathFor(record.recordType, record.slug)),
    inLanguage: record.language ?? 'de',
    ...(record.publishedAt ? { datePublished: new Date(record.publishedAt).toISOString() } : {}),
    ...(record.updatedAt ? { dateModified: new Date(record.updatedAt).toISOString() } : {}),
    ...(record.author ? { author: { '@type': 'Person', name: record.author } } : {}),
    ...(record.shareImage ? { image: absolute(origin, record.shareImage.url) } : {}),
  }
}

/**
 * A partner's LocalBusiness is emitted ONLY while the listing contract is live
 * (§5, §10.5). A lapsed contract must stop being advertised — that is what the
 * sponsor stopped paying for.
 */
export function localBusiness(origin: string, record: SeoRecord, now: Date = new Date()) {
  if (!isContractLive(record, now)) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: record.title,
    description: record.description,
    url: absolute(origin, pathFor(record.recordType, record.slug)),
    ...(record.address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: record.address.street,
            addressLocality: record.address.city,
            addressCountry: record.address.country ?? 'AE',
          },
        }
      : {}),
    ...(record.geo
      ? { geo: { '@type': 'GeoCoordinates', latitude: record.geo.lat, longitude: record.geo.lng } }
      : {}),
    ...(record.openingHours ? { openingHours: record.openingHours } : {}),
    ...(record.discountPercent
      ? {
          makesOffer: {
            '@type': 'Offer',
            name: `${record.discountPercent}% member discount`,
            eligibleCustomerType: 'Member',
          },
        }
      : {}),
  }
}

/** `contract_start + duration + grace >= now` (§5). */
export function isContractLive(record: SeoRecord, now: Date = new Date()): boolean {
  if (!record.contractStart || !record.contractYears) return true // no contract data → not gated
  const end = new Date(record.contractStart)
  end.setFullYear(end.getFullYear() + Number(record.contractYears))
  end.setDate(end.getDate() + Number(record.graceDays ?? 0))
  return end >= now
}

/**
 * Event availability computed from the real registration window and remaining
 * capacity — never a stored copy (FR-022).
 */
export function eventAvailability(record: SeoRecord, now: Date = new Date()) {
  const opens = record.registrationOpensAt ? new Date(record.registrationOpensAt) : null
  const closes = record.registrationClosesAt ? new Date(record.registrationClosesAt) : null
  const capacity = Number(record.capacity ?? 0)
  const taken = Number(record.registeredCount ?? 0)

  if (closes && now > closes) return 'https://schema.org/SoldOut'
  if (capacity > 0 && taken >= capacity) return 'https://schema.org/SoldOut'
  if (opens && now < opens) return 'https://schema.org/PreOrder'
  return 'https://schema.org/InStock'
}

export function event(origin: string, record: SeoRecord, now: Date = new Date()) {
  const startsAt = record.startsAt ? new Date(record.startsAt) : null
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: record.title,
    description: record.description,
    url: absolute(origin, pathFor(record.recordType, record.slug)),
    ...(startsAt ? { startDate: startsAt.toISOString() } : {}),
    // schema.org has no "past" status — EventScheduled is correct for a past
    // event too. Cancellation/postponement come with the events feature.
    eventStatus: record.cancelled ? 'https://schema.org/EventCancelled' : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    ...(record.venue
      ? {
          location: {
            '@type': 'Place',
            name: record.venue.name,
            ...(record.venue.address
              ? { address: { '@type': 'PostalAddress', streetAddress: record.venue.address } }
              : {}),
          },
        }
      : {}),
    offers: {
      '@type': 'Offer',
      // The whole point: this tracks live registration state.
      availability: eventAvailability(record, now),
      url: absolute(origin, pathFor(record.recordType, record.slug)),
      ...(record.priceFrom !== undefined
        ? { price: String(record.priceFrom), priceCurrency: record.currency ?? 'AED' }
        : {}),
    },
  }
}

/** Every document for one record, in emission order. */
export function documentsFor(origin: string, record: SeoRecord, now: Date = new Date()) {
  // Heterogeneous by design: each @type is a different JSON-LD document, and
  // inferring the array from the first push would pin it to Organization.
  const docs: Record<string, unknown>[] = [organization(origin)]
  switch (record.recordType) {
    case 'partner':
    case 'outlet': {
      const lb = localBusiness(origin, record, now)
      if (lb) docs.push(lb)
      break
    }
    case 'event':
      docs.push(event(origin, record, now))
      break
    case 'article':
      docs.push(article(origin, record))
      break
    default:
      break
  }
  if (record.breadcrumbs?.length) docs.push(breadcrumbs(origin, record.breadcrumbs))
  return docs
}
