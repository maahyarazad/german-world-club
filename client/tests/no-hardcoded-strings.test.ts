import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * SC-003 — no interface string is hard-coded in a component.
 *
 * A component that imports `de.ts` directly, or writes a German label inline,
 * survives every language switch silently: the rest of the page changes around
 * it and it does not. That is invisible in German and obvious only to the
 * English-speaking user nobody is watching.
 *
 * Two scans, because the two failure modes look nothing alike.
 */

const SRC = join(process.cwd(), 'src')
const SCANNED = ['console', 'auth', 'components/ui', 'onboarding']

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (/\.tsx?$/.test(entry)) yield full
  }
}

const files = () => SCANNED.flatMap((dir) => [...sourceFiles(join(SRC, dir))])

describe('components read strings through the hook', () => {
  it('has files to scan — the suite is not vacuous', () => {
    expect(files().length).toBeGreaterThan(10)
  })

  it('imports no catalogue directly', () => {
    // `import { t } from '../i18n/de'` hard-codes German into a component
    // and survives every switch. The hook is the only supported way in.
    const offenders = []
    for (const file of files()) {
      const source = readFileSync(file, 'utf8')
      if (/from ['"][^'"]*i18n\/(de|en)(\.tsx?)?['"]/.test(source)) {
        offenders.push(file.replace(`${process.cwd()}/`, ''))
      }
    }
    expect(offenders).toEqual([])
  })

  /**
   * Inline prose in JSX.
   *
   * Scoped to text that renders — `>Text<` between tags, and the attributes a
   * user or a screen reader reads. Class names, imports and comments are not
   * copy and are not scanned.
   */
  it('renders no inline German or English prose', () => {
    const GERMAN = /[äöüß]|\b(Bitte|Ihre|Ihr|Sie|Konto|Passwort|Anmelden|Abmelden|nicht|keine|wurde)\b/
    const offenders = []

    for (const file of files()) {
      const source = readFileSync(file, 'utf8')
      // Strip comments first: the codebase explains itself in prose, and that
      // prose is not rendered.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

      for (const [, text] of code.matchAll(/>\s*([A-Za-zÄÖÜäöüß][^<>{}]{4,})\s*</g)) {
        if (text && GERMAN.test(text)) offenders.push(`${file.replace(`${process.cwd()}/`, '')}: ${text.trim()}`)
      }
      for (const [, text] of code.matchAll(/(?:aria-label|alt|placeholder|title)="([^"{}]{4,})"/g)) {
        if (text && GERMAN.test(text)) offenders.push(`${file.replace(`${process.cwd()}/`, '')}: ${text}`)
      }
    }

    expect(offenders, offenders.join('\n')).toEqual([])
  })

  /**
   * The counter-assertion. Without it, a typo in either pattern would leave a
   * suite that passes by finding nothing, ever.
   */
  it('STILL CATCHES a planted string', () => {
    const GERMAN = /[äöüß]|\b(Bitte|Ihre|Ihr|Sie|Konto|Passwort|Anmelden|Abmelden|nicht|keine|wurde)\b/
    const planted = `<p>Bitte melden Sie sich an</p>`
    const matches = [...planted.matchAll(/>\s*([A-Za-zÄÖÜäöüß][^<>{}]{4,})\s*</g)]
    expect(matches.length).toBeGreaterThan(0)
    expect(GERMAN.test(matches[0]![1]!)).toBe(true)
  })

  it('STILL CATCHES a planted direct import', () => {
    expect(/from ['"][^'"]*i18n\/(de|en)(\.tsx?)?['"]/.test("import { t } from '../i18n/de'")).toBe(true)
  })
})
