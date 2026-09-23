import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * No `SELECT *` on any path that reaches a client.
 *
 * Constitution 2.0.0 removed Principle VI's response-schema requirement and
 * named no replacement. This convention is what is left: with nothing shaping
 * the response, a `SELECT *` is the only thing between a column added to
 * `members` later and a marketplace response body.
 *
 * `specs/007-typescript-migration/contracts/http-boundary-contract.md` already
 * asserts this platform-wide; this suite puts the marketplace and messaging
 * modules explicitly inside that assertion rather than assuming they are
 * covered.
 */

const ROOTS = [
  'src/modules/marketplace',
  'src/modules/messaging',
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

describe('marketplace queries name their columns', () => {
  const files = [...ROOTS.flatMap((root) => [...sourceFiles(join(process.cwd(), root))])]

  it('has files to scan — the suite is not vacuous', () => {
    // Counter-assertion. Without it this passes the day the module moves.
    expect(files.length).toBeGreaterThan(2)
  })

  it.each(files.map((f) => [f.replace(`${process.cwd()}/`, ''), f]))('%s', (_name, file) => {
    const source = readFileSync(file, 'utf8')
      // Strip comments: this file's own prose mentions SELECT *.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    expect(source).not.toMatch(/SELECT\s+\*/i)
  })

  it('STILL catches a planted SELECT * — the counter-assertion', () => {
    const planted = `const { rows } = await query(app.pg, 'SELECT * FROM marketplace_listings')`
    expect(planted).toMatch(/SELECT\s+\*/i)
  })
})
