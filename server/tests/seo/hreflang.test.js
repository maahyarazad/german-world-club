import { describe, it, expect } from 'vitest'
import { buildPageMeta } from '../../src/seo/build-page-meta.js'

/**
 * FR-030 / §10.7. Reciprocity is the whole point: a one-directional hreflang is
 * ignored by search engines, and the two translations then compete as
 * duplicates — suppressing both. Generating the set from `translation_group_id`
 * rather than writing it per page is what makes reciprocity structural.
 */

const ORIGIN = 'https://german-world-club.test'

const group = [
  { language: 'de', slug: 'ueber-uns', recordType: 'page' },
  { language: 'en', slug: 'about-us', recordType: 'page' },
]

const record = (language, slug) => ({
  recordType: 'page',
  recordId: 'r1',
  slug,
  title: 'Über uns',
  description: 'Ein privates Netzwerk deutschsprachiger Expatriates.',
  language,
  indexable: true,
  published: true,
  sections: [],
})

describe('hreflang alternates (FR-030)', () => {
  it('emits one alternate per language in the translation group', () => {
    const meta = buildPageMeta(record('de', 'ueber-uns'), { origin: ORIGIN, alternates: group })
    expect(meta.alternates.map((a) => a.hreflang)).toEqual(expect.arrayContaining(['de', 'en']))
  })

  it('is reciprocal — both members name the same set', () => {
    const de = buildPageMeta(record('de', 'ueber-uns'), { origin: ORIGIN, alternates: group })
    const en = buildPageMeta(record('en', 'about-us'), { origin: ORIGIN, alternates: group })
    const hrefs = (m) => m.alternates.filter((a) => a.hreflang !== 'x-default').map((a) => a.href).sort()
    expect(hrefs(de)).toEqual(hrefs(en))
  })

  it('points x-default at the German version — German is the default (§10.7)', () => {
    const meta = buildPageMeta(record('en', 'about-us'), { origin: ORIGIN, alternates: group })
    const xdefault = meta.alternates.find((a) => a.hreflang === 'x-default')
    expect(xdefault?.href).toBe(`${ORIGIN}/ueber-uns`)
  })

  it('emits absolute hrefs — a relative alternate is ignored', () => {
    const meta = buildPageMeta(record('de', 'ueber-uns'), { origin: ORIGIN, alternates: group })
    for (const alt of meta.alternates) expect(alt.href.startsWith(ORIGIN)).toBe(true)
  })

  it('emits no alternates for a page with no translation group', () => {
    expect(buildPageMeta(record('de', 'ueber-uns'), { origin: ORIGIN }).alternates).toEqual([])
  })

  it('sets the og locale from the record language', () => {
    expect(buildPageMeta(record('de', 'ueber-uns'), { origin: ORIGIN }).og.locale).toBe('de_DE')
    expect(buildPageMeta(record('en', 'about-us'), { origin: ORIGIN }).og.locale).toBe('en_GB')
  })
})
