import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  resolveLocale,
  readStoredLocale,
  writeStoredLocale,
  STORAGE_KEY,
} from '../src/i18n/index.jsx'
import { matchLocale, DEFAULT_LOCALE } from '../src/i18n/locales.js'

/**
 * Locale resolution, and what happens when the browser refuses to remember.
 *
 * The precedence rule is small but every clause earns its place:
 *
 *   stored choice       → wins, or the switch appears not to work next visit
 *   browser preference  → used on a first visit, the one moment the control is
 *                         hardest to find
 *   German              → otherwise
 */

afterEach(() => vi.unstubAllGlobals())

/** A storage that works, one that is absent, one that throws. */
const workingStorage = (initial = {}) => {
  const data = { ...initial }
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => { data[k] = v },
    data,
  }
}

const throwingStorage = () => ({
  getItem: () => { throw new DOMException('denied') },
  setItem: () => { throw new DOMException('denied') },
})

describe('matching a browser tag to an offered locale', () => {
  it.each([
    ['de', 'de'],
    ['de-DE', 'de'],
    ['de-AT', 'de'],
    ['en', 'en'],
    ['en-US', 'en'],
    ['en-GB', 'en'],
    ['EN-gb', 'en'],
  ])('%s resolves to %s', (tag, expected) => {
    // Matched on the primary subtag: a console that only recognised `en-GB`
    // would leave an American browser reading German for no reason.
    expect(matchLocale(tag)).toBe(expected)
  })

  it.each([['fr'], ['fr-FR'], ['ar'], ['zh-Hans'], [''], [null], [undefined]])(
    'does NOT match %s',
    (tag) => {
      // null rather than the default, so a caller can tell "asked for something
      // we do not offer" from "asked for German".
      expect(matchLocale(tag)).toBeNull()
    },
  )
})

describe('the precedence rule', () => {
  it('honours a stored choice over the browser', () => {
    // An explicit choice must outrank a browser default, or the switch would
    // appear not to work on the next visit.
    expect(resolveLocale({ stored: 'de', navigatorLanguages: ['en-GB', 'en'] })).toBe('de')
    expect(resolveLocale({ stored: 'en', navigatorLanguages: ['de-DE'] })).toBe('en')
  })

  it('honours the browser on a first visit', () => {
    expect(resolveLocale({ stored: null, navigatorLanguages: ['en-GB', 'en'] })).toBe('en')
    expect(resolveLocale({ stored: null, navigatorLanguages: ['de-DE'] })).toBe('de')
  })

  it('walks the whole preference list, not just the first entry', () => {
    // A browser set to French first and English second prefers English over
    // our default; taking only languages[0] would give it German.
    expect(resolveLocale({ stored: null, navigatorLanguages: ['fr-FR', 'en-GB'] })).toBe('en')
  })

  it('falls back to German for a browser preferring neither', () => {
    expect(resolveLocale({ stored: null, navigatorLanguages: ['fr-FR', 'ar'] })).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ stored: null, navigatorLanguages: [] })).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ stored: null, navigatorLanguages: null })).toBe(DEFAULT_LOCALE)
  })

  it('reads the real navigator when no list is passed', () => {
    // Passing `undefined` triggers the default parameter, which is the point:
    // production calls `resolveLocale()` with nothing and must consult the
    // actual browser. jsdom reports en-US, so this asserts the wiring rather
    // than the fallback.
    expect(resolveLocale({ stored: null })).toBe('en')
  })

  it('falls back to German for a stored value that is no longer offered', () => {
    // Not blanks. If a locale is ever withdrawn, the people who had chosen it
    // must land somewhere readable rather than on an empty interface.
    expect(resolveLocale({ stored: 'fr', navigatorLanguages: [] })).toBe(DEFAULT_LOCALE)
    expect(resolveLocale({ stored: 'nonsense', navigatorLanguages: [] })).toBe(DEFAULT_LOCALE)
  })

  it('German is the default — the same default §10.7 gives the public pages', () => {
    expect(DEFAULT_LOCALE).toBe('de')
  })
})

describe('storage that refuses to co-operate', () => {
  it('reads and writes when storage works', () => {
    const storage = workingStorage()
    expect(writeStoredLocale('en', storage)).toBe(true)
    expect(storage.data[STORAGE_KEY]).toBe('en')
    expect(readStoredLocale(storage)).toBe('en')
  })

  /**
   * Private browsing and blocked site data both make `localStorage` throw. A
   * language preference is a convenience, not state anything depends on, so it
   * must degrade rather than break (FR-021).
   */
  it('returns null instead of throwing when reading fails', () => {
    expect(() => readStoredLocale(throwingStorage())).not.toThrow()
    expect(readStoredLocale(throwingStorage())).toBeNull()
  })

  it('reports failure instead of throwing when writing fails', () => {
    expect(() => writeStoredLocale('en', throwingStorage())).not.toThrow()
    // false, so a caller could tell the user if it ever mattered — the switch
    // still works for this page, it just will not survive a reload.
    expect(writeStoredLocale('en', throwingStorage())).toBe(false)
  })

  it('still resolves a locale when storage is unavailable entirely', () => {
    expect(resolveLocale({ stored: readStoredLocale(null), navigatorLanguages: ['en'] })).toBe('en')
  })

  it('ignores a stored value that is not a locale at all', () => {
    // Someone else's key, or a half-written value.
    expect(readStoredLocale(workingStorage({ [STORAGE_KEY]: '{"json":true}' }))).toBeNull()
  })
})
