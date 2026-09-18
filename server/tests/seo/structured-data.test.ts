import { describe, it, expect } from 'vitest'
import {
  organization, localBusiness, event, article, breadcrumbs,
  eventAvailability, isContractLive, documentsFor,
} from '../../src/modules/seo/structured-data.ts'

/**
 * SC-007 / FR-022. §10.4: "publishing an Event as available after registration
 * has closed, or a partner as active after their contract lapsed, is both an
 * SEO penalty and a factual misstatement to members."
 *
 * So the documents are computed per request from live state. These tests move
 * the clock and the capacity and assert the output follows.
 */

const ORIGIN = 'https://german-world-club.test'
const NOW = new Date('2026-06-01T12:00:00.000Z')

const validDoc = (doc) => {
  expect(doc['@context']).toBe('https://schema.org')
  expect(typeof doc['@type']).toBe('string')
  expect(doc['@type'].length).toBeGreaterThan(0)
}

describe('Organization', () => {
  it('validates and names the canonical origin', () => {
    const doc = organization(ORIGIN)
    validDoc(doc)
    expect(doc['@type']).toBe('Organization')
    expect(doc.url).toBe(ORIGIN)
  })
})

describe('Event.offers.availability tracks live state (SC-007)', () => {
  const base = {
    recordType: 'event', slug: 'sommerfest', title: 'Sommerfest',
    description: 'Das jährliche Sommerfest des Clubs.',
    startsAt: '2026-07-01T16:00:00.000Z',
    registrationOpensAt: '2026-05-01T00:00:00.000Z',
    registrationClosesAt: '2026-06-20T00:00:00.000Z',
    capacity: 100, registeredCount: 10,
  }

  it('is InStock while registration is open and capacity remains', () => {
    expect(eventAvailability(base, NOW)).toBe('https://schema.org/InStock')
    validDoc(event(ORIGIN, base, NOW))
  })

  it('FLIPS when registration closes — the headline assertion', () => {
    const closed = { ...base, registrationClosesAt: '2026-05-20T00:00:00.000Z' }
    expect(eventAvailability(base, NOW)).toBe('https://schema.org/InStock')
    expect(eventAvailability(closed, NOW)).toBe('https://schema.org/SoldOut')
    expect(event(ORIGIN, closed, NOW).offers.availability).toBe('https://schema.org/SoldOut')
  })

  it('flips when capacity is exhausted, across all sources', () => {
    expect(eventAvailability({ ...base, registeredCount: 100 }, NOW)).toBe('https://schema.org/SoldOut')
  })

  it('is PreOrder before registration opens', () => {
    expect(eventAvailability({ ...base, registrationOpensAt: '2026-06-15T00:00:00.000Z' }, NOW))
      .toBe('https://schema.org/PreOrder')
  })

  it('carries the required Event fields', () => {
    const doc = event(ORIGIN, base, NOW)
    expect(doc).toMatchObject({ '@type': 'Event', name: 'Sommerfest' })
    expect(doc.startDate).toBe('2026-07-01T16:00:00.000Z')
    expect(doc.url).toBe(`${ORIGIN}/events/sommerfest`)
    expect(doc.offers['@type']).toBe('Offer')
  })
})

describe('LocalBusiness stops when the contract lapses (§5, §10.5)', () => {
  const partner = {
    recordType: 'partner', slug: 'mueller-legal', title: 'Müller Legal',
    description: 'Rechtsberatung.', contractStart: '2024-01-01T00:00:00.000Z',
    contractYears: 1, graceDays: 30,
  }

  it('emits LocalBusiness while in contract', () => {
    const live = { ...partner, contractStart: '2026-01-01T00:00:00.000Z' }
    expect(isContractLive(live, NOW)).toBe(true)
    validDoc(localBusiness(ORIGIN, live, NOW))
  })

  it('emits NOTHING once the contract plus grace has passed — a lapsed partner is not advertised', () => {
    expect(isContractLive(partner, NOW)).toBe(false)
    expect(localBusiness(ORIGIN, partner, NOW)).toBeNull()
    expect(documentsFor(ORIGIN, partner, NOW).some((d) => d['@type'] === 'LocalBusiness')).toBe(false)
  })

  it('counts the grace period, not just the term', () => {
    const inGrace = { ...partner, contractStart: '2025-05-20T00:00:00.000Z', contractYears: 1, graceDays: 30 }
    expect(isContractLive(inGrace, NOW)).toBe(true)
  })

  it('treats absent contract data as not gated, so the partners feature can supply it later', () => {
    expect(isContractLive({ recordType: 'partner', slug: 'x' }, NOW)).toBe(true)
  })
})

describe('Article and BreadcrumbList', () => {
  it('emits headline, dates and language', () => {
    const doc = article(ORIGIN, {
      recordType: 'article', slug: 'dubai-guide', title: 'Leben in Dubai',
      description: 'Ein Leitfaden.', publishedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z', author: 'Redaktion', language: 'de',
    })
    validDoc(doc)
    expect(doc).toMatchObject({
      '@type': 'Article', headline: 'Leben in Dubai', inLanguage: 'de',
      datePublished: '2026-02-01T00:00:00.000Z', dateModified: '2026-03-01T00:00:00.000Z',
    })
  })

  it('numbers breadcrumb positions from one and absolutizes each item', () => {
    const doc = breadcrumbs(ORIGIN, [
      { name: 'Partner', path: '/partners' },
      { name: 'Müller', path: '/partners/mueller-legal' },
    ])
    validDoc(doc)
    expect(doc.itemListElement.map((i) => i.position)).toEqual([1, 2])
    expect(doc.itemListElement[0].item).toBe(`${ORIGIN}/partners`)
  })
})

describe('documentsFor', () => {
  it('always includes Organization', () => {
    const docs = documentsFor(ORIGIN, { recordType: 'page', slug: 'impressum', title: 'Impressum', description: 'x' }, NOW)
    expect(docs[0]['@type']).toBe('Organization')
  })

  it('never emits a cached copy — two calls at different clocks disagree', () => {
    const rec = {
      recordType: 'event', slug: 'e', title: 'E', description: 'd',
      registrationClosesAt: '2026-06-15T00:00:00.000Z', capacity: 10, registeredCount: 0,
    }
    const before = documentsFor(ORIGIN, rec, new Date('2026-06-01T00:00:00Z')).find((d) => d['@type'] === 'Event')
    const after = documentsFor(ORIGIN, rec, new Date('2026-06-20T00:00:00Z')).find((d) => d['@type'] === 'Event')
    expect(before.offers.availability).not.toBe(after.offers.availability)
  })
})
