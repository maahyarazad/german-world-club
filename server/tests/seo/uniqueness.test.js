import { describe, it, expect } from 'vitest'
import { buildPageMeta } from '../../src/modules/seo/build-page-meta.js'
import { renderSitemap, shouldInclude } from '../../src/modules/seo/application/sitemap.js'
import { RECORDS } from '../helpers/fixtures.js'

/**
 * SC-006 / §10.3.
 *
 * "Duplicated boilerplate across partner pages suppresses all of them." The
 * assertion is therefore over *every URL the sitemap offers a crawler*, not
 * over a hand-picked sample: any page worth submitting is a page whose title
 * and description must be its own.
 *
 * It is a property test rather than a list of cases because the failure it
 * catches — a template that quietly falls back to a shared line — only shows up
 * across the set.
 */

const ORIGIN = 'https://german-world-club.test'
const NOW = new Date('2026-06-01T00:00:00.000Z')

const indexed = RECORDS.filter((r) => shouldInclude(r, { now: NOW }))

const metaFor = (record) => buildPageMeta(record, { origin: ORIGIN, surfaceAuth: { audience: 'public' } })

const duplicates = (values) => {
  const seen = new Map()
  for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1)
  return [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v)
}

describe('metadata uniqueness across the sitemap (SC-006)', () => {
  it('offers a non-trivial set to assert over', () => {
    expect(indexed.length).toBeGreaterThanOrEqual(5)
  })

  it('has zero duplicate titles', () => {
    expect(duplicates(indexed.map((r) => metaFor(r).title))).toEqual([])
  })

  it('has zero duplicate descriptions', () => {
    expect(duplicates(indexed.map((r) => metaFor(r).description))).toEqual([])
  })

  it('has zero duplicate canonical URLs', () => {
    expect(duplicates(indexed.map((r) => metaFor(r).canonical))).toEqual([])
  })

  it('matches the URLs the sitemap actually emits', () => {
    const { xml } = renderSitemap(ORIGIN, RECORDS, { now: NOW })
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc)
    expect(new Set(locs).size).toBe(locs.length)
    expect(locs.sort()).toEqual(indexed.map((r) => metaFor(r).canonical).sort())
  })

  it('keeps every title within the length the resolver targets', () => {
    for (const record of indexed) {
      // The site-name suffix is appended after truncation, so the bound applies
      // to the record's own half of the title.
      const meta = metaFor(record)
      expect(meta.title.split(' — ')[0].length).toBeLessThanOrEqual(60)
    }
  })

  it('keeps every description within 160 characters', () => {
    for (const record of indexed) {
      expect(metaFor(record).description.length).toBeLessThanOrEqual(160)
    }
  })

  it('derives from record-specific fields — the boilerplate-only path is unreachable', () => {
    for (const record of indexed) {
      const meta = metaFor(record)
      expect(meta.title).not.toBe('German World Club')
      expect(meta.description).not.toBe('')
    }
  })
})
