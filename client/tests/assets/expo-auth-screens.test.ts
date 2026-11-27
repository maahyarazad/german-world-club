import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Feature 043 (US5, research R14 and R15): sign-in, forgot-password and reset-password share
 * one look, because they are built on one layout. The app has no test runner, so this reads its
 * source from here, as `expo-backdrop.test.ts` does.
 *
 * "The same buttons" is kept true structurally rather than by eye: each screen puts its actions
 * in `AuthScreen`'s `actions` slot and only as the standard `Button` / `AsyncButton`, and that
 * slot is laid out with exactly the welcome screen's values. A screen with a hand-styled
 * `Pressable` or a text link is how three screens come to look like three different apps.
 *
 * What it deliberately does NOT require: that the welcome screen or the sign-in code screen use
 * `AuthScreen`. They are unchanged by this feature (spec FR-024), and the last test makes that a
 * stated fact rather than an assumption.
 */
const SRC = join(process.cwd(), '..', 'expo-client', 'german-world-club', 'src')
const read = (...parts: string[]) => readFileSync(join(SRC, ...parts), 'utf8')

const SCREENS = [
  // [file, the least number of standard buttons its actions have]
  ['sign-in.tsx', 2], // Sign in (primary), Forgot password? (secondary)
  ['forgot-password.tsx', 1], // Request code
  ['reset-password.tsx', 2], // Save (primary), Send a new code (secondary)
] as const

describe.each(SCREENS)('%s', (file, buttons) => {
  const source = read('app', '(public)', file)

  it('is built on AuthScreen and not on FormScreen', () => {
    expect(source).toMatch(/from '@\/components\/auth-screen'/)
    expect(source).toMatch(/<AuthScreen\b/)
    expect(source).not.toMatch(/\bFormScreen\b/)
  })

  it('has no hand-made buttons or links: its actions are the standard Button and AsyncButton', () => {
    expect(source).not.toMatch(/\b(Pressable|TouchableOpacity|TouchableHighlight|TouchableWithoutFeedback)\b/)
    const standard = (source.match(/<(Button|AsyncButton)\b/g) ?? []).length
    expect(standard).toBeGreaterThanOrEqual(buttons)
  })

  it('uses only the primary and secondary variants (never danger)', () => {
    const variants = [...source.matchAll(/variant=(?:"([a-z]+)"|'([a-z]+)'|\{\s*['"]([a-z]+)['"]\s*\})/g)]
      .map((m) => m[1] ?? m[2] ?? m[3])
    for (const variant of variants) expect(['primary', 'secondary']).toContain(variant)
  })
})

describe('the shared layout', () => {
  const layout = read('components', 'auth-screen.tsx')
  const welcome = read('app', '(public)', 'index.tsx')

  /** The body of an `actions: { ... }` style entry, with whitespace normalised. */
  const actionsStyle = (source: string) => /\bactions:\s*\{([^}]*)\}/.exec(source)?.[1]?.replace(/\s+/g, ' ').trim()

  // The requester chose the transparent emblem the welcome screen draws (research R14), so the logo
  // is the same file in the same card on every screen a person meets before signing in.
  it('draws the club logo, the same file the welcome screen draws', () => {
    const logo = (source: string) => /require\(\s*'[^']*\/(splash-icon\.png)'\s*\)/.exec(source)?.[1]
    expect(logo(layout), 'AuthScreen no longer draws splash-icon.png').toBe('splash-icon.png')
    expect(logo(welcome)).toBe(logo(layout))
  })

  /** The body of a named style entry, with whitespace normalised. */
  const style = (source: string, name: string) =>
    new RegExp('\\b' + name + ':\\s*\\{([^}]*)\\}').exec(source)?.[1]?.replace(/\s+/g, ' ').trim()

  it('gives the logo the welcome screen\'s card and size', () => {
    for (const name of ['logoCard', 'logo']) {
      expect(style(welcome, name), `the welcome screen has no ${name} style: update this test`).toBeDefined()
      expect(style(layout, name), `AuthScreen's ${name} drifted from the welcome screen's`).toBe(style(welcome, name))
    }
  })

  it('lays its actions out with exactly the welcome screen\'s values', () => {
    const mine = actionsStyle(layout)
    const theirs = actionsStyle(welcome)
    expect(theirs, 'the welcome screen no longer has an `actions` style: update this test').toBeDefined()
    expect(mine).toBe(theirs)
    for (const value of ["gap: Spacing.three", "width: '100%'", "maxWidth: MaxContentWidth", "alignSelf: 'center'"]) {
      expect(mine, `AuthScreen's actions style lost ${value}`).toContain(value)
    }
  })

  it('would notice a logo that drifted in size or card', () => {
    expect(style(layout.replace('height: 220', 'height: 180'), 'logo')).not.toBe(style(welcome, 'logo'))
    expect(style(layout.replace('padding: Spacing.three', 'padding: Spacing.two'), 'logoCard')).not.toBe(style(welcome, 'logoCard'))
  })

  // The counter-assertion: the comparison is not vacuous, because a layout whose `actions` differ would fail it.
  it('would notice a layout whose actions differ', () => {
    // Inside the `actions` entry specifically: the first `gap: Spacing.three` in the file belongs to another style.
    const drifted = layout.replace(/(\bactions:\s*\{[^}]*)gap: Spacing\.three/, '$1gap: Spacing.two')
    expect(drifted).not.toBe(layout)
    expect(actionsStyle(drifted)).not.toBe(actionsStyle(welcome))
  })
})

describe('what this feature leaves alone (spec FR-024)', () => {
  it.each([
    ['index.tsx (the welcome screen)', ['app', '(public)', 'index.tsx']],
    ['sign-in-code.tsx', ['app', '(public)', 'sign-in-code.tsx']],
  ])('%s does not use AuthScreen', (_name, parts) => {
    expect(read(...parts)).not.toMatch(/auth-screen/)
  })
})
