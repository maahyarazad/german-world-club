import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkTokens } from '../scripts/check-tokens'

/**
 * SC-005 — no colour outside the token set.
 *
 * The positive half of this suite would pass against a checker that always
 * returned an empty array, which is exactly the shape of a check that has been
 * quietly disabled. The fixtures below are the counter-assertion: a deliberate
 * hard-coded colour and a deliberate arbitrary value must both be caught.
 */

describe('the console uses only tokens from theme.css', () => {
  it('finds no violation in the console source', () => {
    const violations = checkTokens()
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([])
  })
})

describe('STILL CATCHES a colour that bypasses the token set', () => {
  /** Builds a throwaway client tree with a real theme.css and one bad file. */
  const withFixture = (contents, run) => {
    const root = mkdtempSync(join(tmpdir(), 'gwc-tokens-'))
    try {
      mkdirSync(join(root, 'src/styles'), { recursive: true })
      mkdirSync(join(root, 'src/console'), { recursive: true })
      writeFileSync(
        join(root, 'src/styles/theme.css'),
        '@theme { --color-navy: #0a2457; --color-accent: #d49626; }',
      )
      writeFileSync(join(root, 'src/console/Offender.jsx'), contents)
      run(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('catches a hard-coded hex literal', () => {
    withFixture(`export const bad = { color: '#123456' }\n`, (root) => {
      const violations = checkTokens({ root, dirs: ['src/console'] })
      expect(violations).toHaveLength(1)
      expect(violations[0].value).toBe('#123456')
      expect(violations[0].kind).toBe('hex literal')
    })
  })

  it('catches a Tailwind arbitrary colour value', () => {
    withFixture(`export const Bad = () => <div className="bg-[#d49626]" />\n`, (root) => {
      const violations = checkTokens({ root, dirs: ['src/console'] })
      // Both rules fire: it is an arbitrary value AND the hex is inside it.
      expect(violations.some((v) => v.kind === 'arbitrary colour')).toBe(true)
    })
  })

  it('catches an arbitrary value even when its colour IS a token', () => {
    // The subtle one. `#0a2457` is the navy token, so a naive checker that only
    // compared values would pass this — and the call site would then be left
    // behind the day the token changes.
    withFixture(`export const Bad = () => <div className="text-[#0a2457]" />\n`, (root) => {
      const violations = checkTokens({ root, dirs: ['src/console'] })
      expect(violations.some((v) => v.kind === 'arbitrary colour')).toBe(true)
    })
  })

  it('accepts a colour that theme.css defines', () => {
    // The counter-counter-assertion: the checker must not simply reject
    // everything, or the suite above would pass against a broken check.
    withFixture(`/* nothing but a token reference */\nexport const ok = 'text-navy'\n`, (root) => {
      expect(checkTokens({ root, dirs: ['src/console'] })).toEqual([])
    })
  })
})
