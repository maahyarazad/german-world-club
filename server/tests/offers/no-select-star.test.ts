import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No `SELECT *` or `RETURNING *` on any path that reaches a client (feature 035).
 *
 * Constitution 2.0.0 removed the response-schema requirement and named no
 * replacement; naming columns is what is left. A column added to `offers` or
 * `stores` later must not reach a response by accident.
 */
const ROOTS = [
  'src/modules/stores',
  'src/modules/offers',
  'src/modules/offer-categories',
  'src/modules/redemptions',
]

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return }
  for (const entry of entries) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) yield* sourceFiles(full)
    else if (entry.endsWith('.ts')) yield full
  }
}

describe('store, offer and redemption queries name their columns', () => {
  const files = ROOTS.flatMap((root) => [...sourceFiles(join(process.cwd(), root))])

  it('has files to scan — the suite is not vacuous', () => {
    expect(files.length).toBeGreaterThan(4)
  })

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))('%s', (_name, file) => {
    const source = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(source).not.toMatch(/(SELECT|RETURNING)\s+\*/i)
  })

  it('STILL catches a planted SELECT * — the counter-assertion', () => {
    expect("const { rows } = await query(app.pg, 'SELECT * FROM stores')").toMatch(/(SELECT|RETURNING)\s+\*/i)
    expect('INSERT INTO offers (a) VALUES (1) RETURNING *').toMatch(/(SELECT|RETURNING)\s+\*/i)
  })
})
