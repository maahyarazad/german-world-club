import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'

/**
 * The two landing pages as a translation pair.
 *
 * Each page has its own suite asserting what it owes a visitor. This one
 * asserts what they owe *each other*: that they are still the same page.
 *
 * The check is deliberately **structural rather than textual**. The words
 * differ — that is the point — so nothing here compares copy. But two pages
 * that have drifted apart in structure are no longer translations: a section
 * added to one and not the other means an English reader is quietly getting
 * less, and nobody notices because both pages look fine on their own.
 *
 * The duplication these pages carry is the same trade the palette already
 * makes: `index.html` repeats the design tokens inline and `check-tokens.mjs`
 * proves they have not drifted. This is that guard, for structure.
 */

const read = (file) => readFileSync(join(process.cwd(), file), 'utf8')

const DE_SOURCE = read('index.html')
const EN_SOURCE = read('en.html')

let de
let en

beforeAll(() => {
  de = new JSDOM(DE_SOURCE).window.document
  en = new JSDOM(EN_SOURCE).window.document
})

const idsOf = (doc) => [...doc.querySelectorAll('[id]')].map((el) => el.id).sort()
const headingsOf = (doc) => [...doc.querySelectorAll('h1, h2, h3')].map((el) => el.tagName)
const consoleLinksOf = (doc) =>
  [...doc.querySelectorAll('a[href^="/konsole"]')].map((a) => a.getAttribute('href')).sort()

describe('the two pages are the same page', () => {
  it('has the same element ids', () => {
    expect(en.body ? idsOf(en) : []).toEqual(idsOf(de))
  })

  it('has the same heading structure', () => {
    // Same tags in the same order. A section dropped from one page changes this
    // even when every remaining heading still translates correctly.
    expect(headingsOf(en)).toEqual(headingsOf(de))
  })

  it('offers the same routes into the console', () => {
    expect(consoleLinksOf(en)).toEqual(consoleLinksOf(de))
    // Counter-assertion: there ARE console links, so this is not passing by
    // comparing two empty lists.
    expect(consoleLinksOf(de).length).toBeGreaterThan(0)
  })

  it('has the same number of membership tiers', () => {
    const tiers = (doc) => doc.querySelectorAll('table.tiers tbody th[scope="row"]').length
    expect(tiers(en)).toBe(5)
    expect(tiers(en)).toBe(tiers(de))
  })

  it('quotes the same membership amounts — these are facts, not copy', () => {
    // The design document fixes them and they are NOT re-denominated. Only the
    // thousands separator differs, which is a locale convention rather than a
    // different number.
    const amounts = (doc) => doc.body.textContent.match(/€[\d.,]+/g) ?? []
    expect(amounts(de).length).toBeGreaterThan(0)
    expect(amounts(en).length).toBe(amounts(de).length)
  })

  it('leaves the product nouns untranslated in both', () => {
    // Whitespace collapsed first: the source wraps at 100 columns, so a phrase
    // like "Corporate Club Partner" straddles a newline in the raw text.
    //
    // Case-folded because the footer renders the brand as GERMAN WORLD CLUB.
    // That is a styling choice, not a translation — the point of this test is
    // that the WORDS are the same in both languages.
    const text = (doc) => doc.body.textContent.replace(/\s+/g, ' ').toLowerCase()
    for (const noun of ['Ask GWC', 'Club Merchant', 'Corporate Club Partner', 'German World Club']) {
      expect(text(de), `de: ${noun}`).toContain(noun.toLowerCase())
      expect(text(en), `en: ${noun}`).toContain(noun.toLowerCase())
    }
  })

  /**
   * The counter-assertion for this entire file.
   *
   * Everything above compares structure, and a page duplicated verbatim would
   * satisfy all of it. This is what proves one of them was actually translated.
   */
  it('BUT the prose differs — one is not a copy of the other', () => {
    expect(EN_SOURCE).not.toBe(DE_SOURCE)
    expect(en.querySelector('h1').textContent).not.toBe(de.querySelector('h1').textContent)
    expect(en.title).not.toBe(de.title)
  })
})

describe('neither page depends on JavaScript', () => {
  it.each([
    ['index.html', () => de],
    ['en.html', () => en],
  ])('%s has no script tag and no external stylesheet', (_file, doc) => {
    expect(doc().querySelectorAll('script')).toHaveLength(0)
    expect(doc().querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
    expect(doc().querySelector('style')).not.toBeNull()
  })
})

describe('each page points at the other', () => {
  it('the German page links to /en, the English page links to /', () => {
    const langLinks = (doc) =>
      [...doc.querySelectorAll('nav.lang a')].map((a) => a.getAttribute('href'))
    expect(langLinks(de)).toEqual(['/en'])
    expect(langLinks(en)).toEqual(['/'])
  })

  it('marks the current language rather than only showing it', () => {
    // aria-current, so it is announced and not merely styled. The gold
    // underline may mark it but must never carry the meaning alone.
    expect(de.querySelector('nav.lang [aria-current="true"]').textContent.trim()).toBe('Deutsch')
    expect(en.querySelector('nav.lang [aria-current="true"]').textContent.trim()).toBe('English')
  })

  it('names each language in that language', () => {
    // Someone who cannot read the current language needs to recognise the
    // target. "Englisch" does not help an English speaker.
    for (const doc of [de, en]) {
      const text = doc.querySelector('nav.lang').textContent
      expect(text).toContain('Deutsch')
      expect(text).toContain('English')
    }
  })

  it('uses no flag for either language', () => {
    // A flag names a country. There is no flag meaning "English" to a reader in
    // Dubai, Zürich and Singapore at once.
    for (const [name, source] of [['de', DE_SOURCE], ['en', EN_SOURCE]]) {
      const nav = new JSDOM(source).window.document.querySelector('nav.lang')
      expect(nav.querySelectorAll('img, svg'), `${name} uses an image in the control`).toHaveLength(0)
      // Regional indicator symbols — the emoji flags.
      expect(nav.textContent, `${name} uses a flag emoji`).not.toMatch(/[\u{1F1E6}-\u{1F1FF}]/u)
    }
  })

  it('declares the language of each option, so a screen reader pronounces it', () => {
    for (const doc of [de, en]) {
      const options = [...doc.querySelectorAll('nav.lang a, nav.lang span[aria-current]')]
      expect(options.map((o) => o.getAttribute('lang')).sort()).toEqual(['de', 'en'])
    }
  })
})

describe('the pair is declared to crawlers', () => {
  const alternates = (doc) =>
    [...doc.querySelectorAll('link[rel="alternate"]')].map((l) => ({
      hreflang: l.getAttribute('hreflang'),
      href: l.getAttribute('href'),
    }))

  it('both pages name the same alternate set — reciprocity is the whole point', () => {
    // A one-directional hreflang is ignored, and the two pages then compete as
    // duplicates, suppressing both.
    expect(alternates(en)).toEqual(alternates(de))
    expect(alternates(de).length).toBeGreaterThan(0)
  })

  it('x-default points at the German page (§10.7)', () => {
    for (const doc of [de, en]) {
      const xd = alternates(doc).find((a) => a.hreflang === 'x-default')
      expect(xd?.href).toMatch(/german-world-club\.com\/$/)
    }
  })

  /**
   * The single most consequential line in this feature.
   *
   * Canonicalising a translation onto its original tells the crawler "this is a
   * duplicate, index the other one" — which delists the English page entirely.
   * `hreflang` exists to express exactly the relationship `rel=canonical`
   * destroys.
   */
  it('each page is canonical for ITSELF, never for the other', () => {
    expect(de.querySelector('link[rel="canonical"]').href).toMatch(/german-world-club\.com\/$/)
    expect(en.querySelector('link[rel="canonical"]').href).toMatch(/german-world-club\.com\/en$/)
  })
})
