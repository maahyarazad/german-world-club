import { describe, it, expect } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Every query in `modules/messaging/application/` names its columns.
 *
 * Constitution 2.0.0 removed the response-schema gate, so nothing in the
 * framework now stops a column added to `members` later from reaching a
 * client. In messaging that column would be an email address or a mobile
 * number travelling in a payload that already carries two members' data — the
 * exact failure FR-026 names.
 *
 * So this is a convention backed by a test where it used to be a property of
 * the framework. `contracts/messaging-api.md` assertion 6.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APPLICATION_DIR = path.resolve(HERE, '..', '..', 'src', 'modules', 'messaging', 'application')

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  }))
  return files.flat()
}

describe('messaging queries name their columns', () => {
  it('has application sources to check', async () => {
    // Without this the sweep below would pass against a directory that had
    // been renamed or emptied.
    expect((await sourceFiles(APPLICATION_DIR)).length).toBeGreaterThan(0)
  })

  it('contains no SELECT *', async () => {
    const offenders: string[] = []

    for (const file of await sourceFiles(APPLICATION_DIR)) {
      const source = await readFile(file, 'utf8')
      source.split('\n').forEach((line, index) => {
        // Comments are skipped, because the modules that follow this rule
        // explain it in prose — and a test that flagged the explanation would
        // make documenting the rule impossible.
        const trimmed = line.trim()
        if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return

        // `count(*)` and `to_jsonb(d.*)` are not the hazard — an unqualified
        // `SELECT *` widening with the table is.
        if (/SELECT\s+\*/i.test(line)) {
          offenders.push(`${path.basename(file)}:${index + 1}`)
        }
      })
    }

    expect(offenders).toEqual([])
  })

  it('WOULD catch one — the counter-assertion', () => {
    // Proves the matcher works, so the empty result above means "none present"
    // rather than "the regex never matches anything".
    const sample = '  const { rows } = await query(app.pg, `SELECT * FROM messages`)'
    expect(/SELECT\s+\*/i.test(sample)).toBe(true)
  })
})
