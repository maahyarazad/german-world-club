#!/usr/bin/env node
/**
 * SC-005: no colour outside the token set reaches the build.
 *
 * The design document's rule — "Gold nur als gezielter Marken- und
 * Aktionsakzent" — survives review for about a week. It survives a build check
 * indefinitely. This is that check.
 *
 * It scans the console source for hex literals and Tailwind arbitrary colour
 * values, and fails on any that theme.css does not define. The point is not
 * tidiness: a hard-coded `#D49626` is how gold stops being an accent, and a
 * hand-picked near-navy is how the palette stops being one palette.
 *
 * Two scopes, checked differently.
 *
 *   - The console source (SCANNED below) must use tokens and nothing else.
 *   - `index.html` and `en.html` are the public landing pages. They carry their
 *     colours inline as CSS custom properties rather than as tokens, because
 *     they must render without a stylesheet or a bundle (Constitution "Public
 *     rendering"). That duplication is deliberate and would otherwise rot
 *     silently, so the second check below compares each `:root` block against
 *     theme.css value by value.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const THEME = join(CLIENT_ROOT, 'src/styles/theme.css')

/** Directories the console owns. Everything here must use tokens only. */
const SCANNED = ['src/console', 'src/components/ui', 'src/auth', 'src/lib']

const HEX = /#[0-9a-fA-F]{3,8}\b/g
/** Tailwind arbitrary values that carry a colour: bg-[#fff], text-[rgb(...)]. */
const ARBITRARY = /\b(?:bg|text|border|ring|fill|stroke|from|via|to|shadow|outline|decoration|accent|caret|divide|placeholder)-\[(#[^\]]+|rgb[^\]]*|hsl[^\]]*|oklch[^\]]*)\]/g

function allowedColours() {
  const css = readFileSync(THEME, 'utf8')
  const allowed = new Set()
  for (const match of css.matchAll(HEX)) allowed.add(match[0].toLowerCase())
  return allowed
}

function* walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return // a scanned directory that does not exist yet is not a violation
  }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      yield* walk(full)
    } else if (/\.(jsx?|css)$/.test(entry)) {
      yield full
    }
  }
}

/**
 * The landing page's inline palette must match theme.css exactly.
 *
 * It declares `--navy`, `--accent` and so on; theme.css declares
 * `--color-navy`, `--color-accent`. Same names, different prefix, so they are
 * compared by the suffix. A colour the landing page invents, or one that has
 * drifted from the token, fails here — which is the only thing standing between
 * "one palette" and "two palettes that used to agree".
 */
/** Every static page that carries the palette inline. */
const INLINE_PALETTE_PAGES = ['index.html', 'en.html']

function checkLandingPalette(root) {
  return INLINE_PALETTE_PAGES.flatMap((page) => checkOnePagePalette(root, page))
}

function checkOnePagePalette(root, page) {
  const violations = []
  let html
  try {
    html = readFileSync(join(root, page), 'utf8')
  } catch {
    return violations // a page that does not exist yet is not a palette violation
  }

  const theme = readFileSync(join(root, 'src/styles/theme.css'), 'utf8')
  const tokens = new Map()
  for (const match of theme.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    tokens.set(match[1], match[2].toLowerCase())
  }

  const rootBlock = html.match(/:root\s*\{([\s\S]*?)\}/)
  if (!rootBlock) {
    violations.push({ file: page, line: 0, value: ':root', kind: 'no inline palette found' })
    return violations
  }

  for (const match of rootBlock[1].matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{3,8})/g)) {
    const [, name, value] = match
    const expected = tokens.get(name)
    if (expected === undefined) {
      violations.push({
        file: page,
        line: 0,
        value: `--${name}`,
        kind: 'colour not defined in theme.css',
      })
    } else if (expected !== value.toLowerCase()) {
      violations.push({
        file: page,
        line: 0,
        value: `--${name}: ${value} (theme.css says ${expected})`,
        kind: 'drifted from token',
      })
    }
  }

  return violations
}

export function checkTokens({ root = CLIENT_ROOT, dirs = SCANNED } = {}) {
  const allowed = allowedColours()
  const violations = checkLandingPalette(root)

  for (const dir of dirs) {
    for (const file of walk(join(root, dir))) {
      const source = readFileSync(file, 'utf8')
      const where = relative(root, file)

      source.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(HEX)) {
          if (!allowed.has(match[0].toLowerCase())) {
            violations.push({ file: where, line: index + 1, value: match[0], kind: 'hex literal' })
          }
        }
        for (const match of line.matchAll(ARBITRARY)) {
          // An arbitrary value is a violation even when its colour happens to
          // be a token one: it bypasses the token indirection, so swapping the
          // token later would silently leave this call site behind.
          violations.push({ file: where, line: index + 1, value: match[0], kind: 'arbitrary colour' })
        }
      })
    }
  }

  return violations
}

// Run as a script rather than imported by the test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = checkTokens()
  if (violations.length === 0) {
    console.log('✓ token check: no colour outside src/styles/theme.css')
    process.exit(0)
  }
  console.error(`✗ token check: ${violations.length} violation(s)\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.kind}  ${v.value}`)
  }
  console.error('\nDefine the colour in src/styles/theme.css and use the token instead.')
  process.exit(1)
}
