/**
 * SC-002: the catalogues have identical key sets.
 *
 * This is the single most valuable check in the language feature, because a
 * missing translation is otherwise invisible. A key that exists only in German
 * is fine on every screen until somebody switches language on the one screen
 * that uses it — and then they get a blank space, or a raw dotted path, in
 * front of a member.
 *
 * Three failures, not one:
 *
 *   - a key in `de` and not in `en`
 *   - a key in `en` and not in `de`  ← as much a defect, usually a half-landed rename
 *   - the same path holding a string in one and an object in the other, which
 *     is a merge artefact rather than a translation
 *
 * Reporting only the first direction would let a rename sit half-finished
 * indefinitely, so both are reported.
 */

import { readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const I18N_DIR = join(CLIENT_ROOT, 'src/i18n')

/** Modules in src/i18n that are catalogues rather than machinery. */
const NOT_A_CATALOGUE = new Set(['index.ts', 'index.tsx', 'locales.ts'])

/**
 * Every dotted path in a catalogue, with the type of its leaf.
 *
 * Arrays are treated as leaves: none of the copy uses them today, and if any
 * ever does, comparing element-by-element would report noise rather than a
 * missing translation.
 */
function flatten(value, prefix = '', out = new Map()) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
    return out
  }
  out.set(prefix, Array.isArray(value) ? 'array' : typeof value)
  return out
}

export async function loadCatalogues(dir = I18N_DIR) {
  const catalogues = new Map()
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.ts') || NOT_A_CATALOGUE.has(entry)) continue
    const locale = entry.replace(/\.ts$/, '')
    const module = await import(pathToFileURL(join(dir, entry)).href)
    // Each catalogue exports itself under its locale name (`export const de`).
    const catalogue = module[locale] ?? module.default
    if (!catalogue) throw new Error(`${entry} exports neither \`${locale}\` nor a default`)
    catalogues.set(locale, catalogue)
  }
  return catalogues
}

/**
 * Compare catalogues against each other. Pure — takes objects, returns problems.
 *
 * Separate from `loadCatalogues` so the comparison, which is the part with the
 * logic in it, can be driven from plain objects in a test. Reading files off
 * disk is the trivial half and is covered by running the real directory.
 *
 * Generalises to N locales without modification: a third catalogue is a third
 * entry in the map and nothing here changes.
 */
export function compareCatalogues(catalogues) {
  const problems = []

  if (catalogues.size === 0) {
    problems.push({ kind: 'no catalogues found', locale: '-', key: '(none)' })
    return problems
  }

  const flat = new Map([...catalogues].map(([locale, c]) => [locale, flatten(c)]))
  const allKeys = new Set([...flat.values()].flatMap((m) => [...m.keys()]))

  for (const key of [...allKeys].sort()) {
    const present = [...flat].filter(([, m]) => m.has(key)).map(([locale]) => locale)
    const missing = [...flat.keys()].filter((locale) => !flat.get(locale).has(key))

    if (missing.length > 0) {
      problems.push({
        kind: 'missing key',
        key,
        locale: missing.join(', '),
        detail: `present in ${present.join(', ')}`,
      })
      continue
    }

    const types = new Set(present.map((locale) => flat.get(locale).get(key)))
    if (types.size > 1) {
      problems.push({
        kind: 'type mismatch',
        key,
        locale: present.join(', '),
        detail: [...types].join(' vs '),
      })
    }
  }

  return problems
}

/** Load the catalogues in `dir` and compare them. */
export async function checkCatalogues(dir = I18N_DIR) {
  return compareCatalogues(await loadCatalogues(dir))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = await checkCatalogues()
  if (problems.length === 0) {
    const catalogues = await loadCatalogues()
    console.log(`✓ i18n check: ${catalogues.size} catalogues (${[...catalogues.keys()].join(', ')}) agree on every key`)
    process.exit(0)
  }
  console.error(`✗ i18n check: ${problems.length} problem(s)\n`)
  for (const p of problems) {
    console.error(`  ${p.kind.padEnd(14)} ${p.key}\n${''.padEnd(18)}${p.locale}${p.detail ? ` — ${p.detail}` : ''}`)
  }
  console.error('\nEvery catalogue must define every key. A missing translation is invisible until')
  console.error('someone switches language on the one screen that uses it.')
  process.exit(1)
}
