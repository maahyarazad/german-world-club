import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * A page that shows a success message must bring it into view (feature 041,
 * FR-010, SC-005). `useReveal` is how; this scan is what keeps the next page
 * from forgetting, in the manner of the source scan in loading-states.test.tsx.
 *
 * What it catches: a source file that shows a success-toned message and never
 * calls `useReveal`, and a page that calls the hook and never gives the ref to
 * an element (which does nothing, silently).
 *
 * What it does NOT catch, stated plainly: an outcome shown in a `Callout` and
 * not as a success-toned `FormMessage` (Marketplace's "Posted", the push page's
 * "queued"), in a page that is not on the named list below. The named list is
 * what covers those two; a third page like them has to be added to it by hand.
 */
const SRC = join(import.meta.dirname, '../src')
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.tsx') ? [path] : []
  })

/**
 * A success message set on a page's state, or rendered with the tone. Narrow on
 * purpose: `StatusPill` and others have tones of their own, and `'success'`
 * alone matches them.
 */
const SHOWS_SUCCESS = /setMessage\(\{\s*tone:\s*'success'|<FormMessage[^>]*tone="success"/

/** Files that show a success message and are right not to reveal it; each with its reason. */
const NOT_REVEALED: Record<string, string> = {
  'auth/PasswordReset.tsx': 'the success replaces its own form, so it is where the person is already looking',
}

/** The pages of FR-009, which must reveal: two of them use a Callout, which the pattern cannot see. */
const REVEALING_PAGES = [
  'member/profile/EditProfile.tsx',
  'member/Marketplace.tsx',
  'organisation/Profile.tsx',
  'organisation/Store.tsx',
  'organisation/OfferEditor.tsx',
  'console/admin/OfferCategories.tsx',
  'console/admin/Push.tsx',
]

/** A call, with or without its type argument: `useReveal(x)` or `useReveal<HTMLDivElement>(x)`. */
const CALLS_REVEAL = /\buseReveal(<[^>]*>)?\(/

/** True when the source shows a success message and has no `useReveal` call. */
const unrevealed = (source: string) => SHOWS_SUCCESS.test(source) && !CALLS_REVEAL.test(source)

/** Variables that hold a `useReveal` ref, and whether any of them reaches a `ref={…}`. */
const refIsAttached = (source: string) => {
  const names = [...source.matchAll(/const (\w+) = useReveal\b/g)].map((m) => m[1]!)
  return names.length > 0 && names.every((name) => source.includes(`ref={${name}}`))
}

const sources = files(SRC).map((path) => ({ rel: relative(SRC, path), source: readFileSync(path, 'utf8') }))
const read = (rel: string) => sources.find((s) => s.rel === rel)?.source

describe('outcome messages are brought into view', () => {
  it('actually reads the sources (a broken glob passes vacuously)', () => {
    expect(sources.length).toBeGreaterThan(60)
    // The five pages that set a success message, and the password reset.
    expect(sources.filter(({ source }) => SHOWS_SUCCESS.test(source)).length).toBeGreaterThanOrEqual(6)
  })

  it('has no page that shows a success message without useReveal', () => {
    const offenders = sources
      .filter(({ rel, source }) => unrevealed(source) && !(rel in NOT_REVEALED))
      .map(({ rel }) => rel)
    expect(offenders, `These show a success message and never bring it into view; call useReveal (src/lib/useReveal.ts): ${offenders.join(', ')}`).toEqual([])
  })

  it('has every page of the feature calling useReveal and giving the ref to the message', () => {
    for (const rel of REVEALING_PAGES) {
      const source = read(rel)
      expect(source, `${rel} is missing`).toBeDefined()
      expect(CALLS_REVEAL.test(source!), `${rel} must call useReveal`).toBe(true)
      expect(refIsAttached(source!), `${rel} calls useReveal but never gives its ref to the message`).toBe(true)
    }
  })

  it('keeps the allow-list honest: each entry exists, still shows a success message, and says why', () => {
    for (const [rel, reason] of Object.entries(NOT_REVEALED)) {
      expect(read(rel), `${rel} is gone: remove it from the allow-list`).toBeDefined()
      expect(SHOWS_SUCCESS.test(read(rel)!), `${rel} no longer shows a success message: remove it from the allow-list`).toBe(true)
      expect(reason.length).toBeGreaterThan(10)
    }
  })

  // Counter-assertions: the scan can say yes and it can say no.
  describe('the scan itself', () => {
    it('reports a success message with no hook', () => {
      expect(unrevealed("setMessage({ tone: 'success', text: t.x.saved })")).toBe(true)
      expect(unrevealed('<FormMessage\n  tone="success"\n>Saved</FormMessage>')).toBe(true)
    })

    it('does not report one that has the hook, nor a message that is not a success', () => {
      expect(unrevealed("const messageRef = useReveal<HTMLDivElement>(message)\nsetMessage({ tone: 'success', text: 'x' })")).toBe(false)
      expect(unrevealed("setMessage({ tone: 'danger', text: 'x' })")).toBe(false)
      // A pill's tone is not a message: the pattern must not catch it.
      expect(unrevealed("<StatusPill tone=\"success\">Active</StatusPill>")).toBe(false)
      expect(unrevealed("const TONE = { tone: 'success' }")).toBe(false)
    })

    it('reports a hook whose ref is never given to an element', () => {
      expect(refIsAttached('const messageRef = useReveal<HTMLDivElement>(message)\n<FormMessage ref={messageRef}>')).toBe(true)
      expect(refIsAttached('const messageRef = useReveal<HTMLDivElement>(message)\n<FormMessage>')).toBe(false)
      expect(refIsAttached('<FormMessage>')).toBe(false)
    })
  })
})
