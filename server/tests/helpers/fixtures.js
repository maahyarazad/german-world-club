import { buildApp } from '../../src/app.js'
import { createFixtureContentSource } from '../../src/public/content.js'

/**
 * A small but representative content set — one record per public route class,
 * each with its own title, description and slug.
 *
 * Every record is distinct on purpose: SC-006 asserts zero duplicate titles,
 * descriptions or canonical URLs, and a fixture set that shared boilerplate
 * would make that assertion vacuous.
 */
export const RECORDS = Object.freeze([
  {
    recordType: 'page', recordId: 'pg-about', slug: 'about',
    title: 'Über den German World Club',
    description: 'Ein privates Netzwerk deutschsprachiger Expatriates in den Vereinigten Arabischen Emiraten.',
    language: 'de', translationGroupId: 'tg-about', indexable: true, published: true,
    updatedAt: '2026-02-10T08:00:00.000Z', sections: [{ heading: 'Auftrag', body: 'Verbinden, fördern, vertreten.' }],
  },
  {
    recordType: 'page', recordId: 'pg-about-en', slug: 'about-us',
    title: 'About the German World Club',
    description: 'A private network of German-speaking expatriates in the United Arab Emirates.',
    language: 'en', translationGroupId: 'tg-about', indexable: true, published: true,
    updatedAt: '2026-02-10T08:00:00.000Z', sections: [],
  },
  {
    recordType: 'page', recordId: 'pg-imprint', slug: 'imprint',
    title: 'Impressum',
    description: 'Angaben gemäß den rechtlichen Anforderungen der Vereinigten Arabischen Emirate.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2026-01-05T08:00:00.000Z', sections: [],
  },
  {
    recordType: 'partner', recordId: 'pt-mueller', slug: 'mueller-legal',
    title: 'Müller Legal Consultants',
    description: 'Deutschsprachige Rechtsberatung für Expatriates in Dubai und Abu Dhabi.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2026-03-01T10:00:00.000Z',
    address: { street: 'Sheikh Zayed Road 12', city: 'Dubai', country: 'AE' },
    openingHours: ['Mo-Fr 09:00-17:00'], discountPercent: 15,
    contractStart: '2026-01-01T00:00:00.000Z', contractYears: 2, graceDays: 30,
    shareImage: { url: '/media/aa11/large.webp', width: 1600, height: 1200, alt: 'Die Kanzlei in Dubai' },
    sections: [],
  },
  {
    recordType: 'partner', recordId: 'pt-lapsed', slug: 'altes-atelier',
    title: 'Altes Atelier Interiors',
    description: 'Innenarchitektur mit deutschem Handwerk, ehemaliger Partner des Clubs.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2024-06-01T10:00:00.000Z',
    // Term plus grace expired long before `NOW` — SC-008's lapsed partner.
    contractStart: '2022-01-01T00:00:00.000Z', contractYears: 1, graceDays: 30,
    sections: [],
  },
  {
    recordType: 'outlet', recordId: 'ol-marina', slug: 'mueller-legal-marina',
    title: 'Müller Legal Consultants — Dubai Marina',
    description: 'Die Zweigstelle der Kanzlei in Dubai Marina, mit eigenen Sprechzeiten.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2026-03-02T10:00:00.000Z',
    address: { street: 'Marina Walk 4', city: 'Dubai', country: 'AE' },
    openingHours: ['Mo-Do 10:00-18:00'], discountPercent: 10,
    partner: { slug: 'mueller-legal', title: 'Müller Legal Consultants' },
    contractStart: '2026-01-01T00:00:00.000Z', contractYears: 2, graceDays: 30,
    sections: [],
  },
  {
    recordType: 'event', recordId: 'ev-sommerfest', slug: 'sommerfest-2026',
    title: 'Sommerfest 2026',
    description: 'Das jährliche Sommerfest des Clubs auf der Terrasse am Kanal.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2026-04-01T10:00:00.000Z',
    startsAt: '2026-07-01T16:00:00.000Z',
    registrationOpensAt: '2026-05-01T00:00:00.000Z',
    registrationClosesAt: '2026-06-20T00:00:00.000Z',
    capacity: 120, registeredCount: 44,
    venue: { name: 'Club-Terrasse', address: 'Dubai Creek Harbour' },
    sections: [],
  },
  {
    recordType: 'article', recordId: 'ar-guide', slug: 'leben-in-dubai',
    title: 'Leben in Dubai: ein Leitfaden für Neuankömmlinge',
    description: 'Wohnen, Schule, Visum und Bankkonto — die ersten Schritte in den Emiraten.',
    language: 'de', indexable: true, published: true,
    author: 'Redaktion', publishedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-03-15T10:00:00.000Z', sections: [],
  },
  {
    recordType: 'committee', recordId: 'cm-kultur', slug: 'kulturkomitee',
    title: 'Kulturkomitee',
    description: 'Das Komitee für Kultur, Musik und Ausstellungen des German World Club.',
    language: 'de', indexable: true, published: true,
    updatedAt: '2026-01-20T10:00:00.000Z', sections: [],
  },
  {
    recordType: 'article', recordId: 'ar-draft', slug: 'noch-nicht-fertig',
    title: 'Ein unveröffentlichter Entwurf',
    description: 'Dieser Entwurf darf nirgends erscheinen, auch nicht als Teaser.',
    language: 'de', indexable: true, published: false,
    updatedAt: '2026-05-01T10:00:00.000Z', sections: [],
  },
  {
    recordType: 'article', recordId: 'ar-noindex', slug: 'intern-aber-oeffentlich',
    title: 'Veröffentlicht, aber bewusst nicht indexiert',
    description: 'Erreichbar über den Link, aber absichtlich aus dem Index genommen.',
    language: 'de', indexable: false, published: true,
    updatedAt: '2026-05-02T10:00:00.000Z', sections: [],
  },
])

/** The public URL each fixture record is served at. */
export const PUBLIC_PATHS = Object.freeze({
  page: (slug) => `/${slug}`,
  partner: (slug) => `/partners/${slug}`,
  outlet: (slug) => `/outlets/${slug}`,
  event: (slug) => `/events/${slug}`,
  article: (slug) => `/magazine/${slug}`,
  committee: (slug) => `/committees/${slug}`,
})

/**
 * Build an app whose public routes resolve from `RECORDS` instead of SQL, so
 * the delivery suites assert on the resolver and the templates.
 */
export async function buildFixtureApp(records = RECORDS) {
  const app = await buildApp({ contentSource: createFixtureContentSource(records) })
  await app.ready()
  return app
}

/** The host `inject` sends by default must match the canonical origin, or every request 301s. */
export const HTML = Object.freeze({ accept: 'text/html,application/xhtml+xml' })
