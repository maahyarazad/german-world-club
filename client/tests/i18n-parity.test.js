import { describe, it, expect } from 'vitest'
import { checkCatalogues, compareCatalogues } from '../scripts/check-i18n.mjs'

/**
 * SC-002 — every catalogue defines every key.
 *
 * The positive test below would pass against a checker that always returned an
 * empty array, which is exactly what a quietly disabled check looks like. The
 * fixtures are the counter-assertion: three distinct ways of getting the
 * catalogues out of step, each of which must fail.
 */

/**
 * Drive the comparison with plain objects.
 *
 * Not temp files: the comparison is the half with the logic in it, and reading
 * files off disk is covered by running the real directory in the first test.
 */
const compare = (catalogues) => compareCatalogues(new Map(Object.entries(catalogues)))

describe('the real catalogues agree', () => {
  it('finds no problem in client/src/i18n', async () => {
    const problems = await checkCatalogues()
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([])
  })
})

describe('STILL CATCHES catalogues that have drifted apart', () => {
  it('catches a key present in German and missing from English', () => {
    const problems = compare({ de: { a: 'eins', b: 'zwei' }, en: { a: 'one' } })
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('missing key')
    expect(problems[0].key).toBe('b')
    expect(problems[0].locale).toBe('en')
  })

  /**
   * The other direction, which is the one a single-direction check misses. It
   * usually means a rename landed in one file and not the other, and it leaves
   * a dead string that nobody notices because nothing renders it.
   */
  it('catches a key present in English and missing from German', () => {
    const problems = compare({ de: { a: 'eins' }, en: { a: 'one', b: 'two' } })
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('missing key')
    expect(problems[0].locale).toBe('de')
  })

  it('catches a string in one catalogue where the other has an object', () => {
    const problems = compare({ de: { a: { title: 'Titel' } }, en: { a: 'one' } })
    // The nested path exists only in German, and the leaf type differs — either
    // way it is a merge artefact rather than a translation.
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.map((p) => p.kind)).toContain('missing key')
  })

  it('catches a type mismatch at the same path', () => {
    const problems = compare({ de: { a: 'eins', n: 1 }, en: { a: 'one', n: 'one' } })
    expect(problems).toHaveLength(1)
    expect(problems[0].kind).toBe('type mismatch')
    expect(problems[0].key).toBe('n')
  })

  it('reaches into nested keys, not only the top level', () => {
    const problems = compare({
      de: { signIn: { title: 'Anmeldung', submit: 'Anmelden' } },
      en: { signIn: { title: 'Sign in' } },
    })
    expect(problems).toHaveLength(1)
    expect(problems[0].key).toBe('signIn.submit')
  })

  /**
   * The counter-counter-assertion: the checker must not simply reject
   * everything, or every test above would pass against a broken check.
   */
  it('accepts two catalogues that genuinely match', () => {
    const problems = compare({
      de: { a: 'eins', nested: { b: 'zwei' } },
      en: { a: 'one', nested: { b: 'two' } },
    })
    expect(problems).toEqual([])
  })
})
