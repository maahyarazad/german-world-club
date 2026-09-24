import { PROBLEMS } from '@gwc/contracts/errors'
import { HANDLE_CHANGE_DAYS, HANDLE_PATTERN, RESERVED_HANDLES, normaliseHandle } from '@gwc/contracts/profile'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Handles (feature 010, research R7).
 *
 * Format and reserved words are checked here by hand as well as by the
 * request schema, because feature 007 Phase 6 removes the schemas and the rule
 * must outlive them (data-model §7). The format is also a CHECK constraint;
 * the reserved list is not, because it is policy that will change.
 */

const RESERVED = new Set<string>(RESERVED_HANDLES)

/**
 * A validation failure that names its field, shaped like a schema failure so
 * the error handler emits the same `errors: [{ path, message }]` a client
 * already reads for every other form. A thrown message alone would leave the
 * client matching on `detail`, which clients must never do.
 */
export function fieldError(field: string, message: string) {
  const error = new Error(message) as Error & { validation: unknown[]; statusCode: number }
  error.validation = [{ instancePath: `/${field}`, message }]
  error.statusCode = 400
  return error
}

/** Why a handle cannot be taken, or null if it can be as far as its shape goes. */
function shapeProblem(handle: string): string | null {
  if (!HANDLE_PATTERN.test(handle)) {
    return 'A handle is 3–30 lowercase letters, digits, dots or underscores, not starting or ending with a dot.'
  }
  if (RESERVED.has(handle)) return 'That handle is not available.'
  return null
}

/**
 * Taken and reserved answer the same `false`: an availability probe that
 * distinguished them would be a free list of which reserved words the club
 * cares about, and nothing a member does differs between the two.
 */
export async function isHandleAvailable(
  app: GwcApp,
  { memberId, handle: raw, signal }: { memberId: string; handle: string; signal?: AbortSignal },
) {
  const handle = normaliseHandle(raw)
  if (shapeProblem(handle)) return { available: false }
  const { rows } = await query(
    app.pg,
    'SELECT id FROM members WHERE handle = $1::citext',
    [handle],
    { signal },
  )
  // Your own current handle is "available" to you — re-saving it is a no-op.
  return { available: rows.length === 0 || String(rows[0]!.id) === memberId }
}

/**
 * Set or change the caller's handle.
 *
 * The 30-day rule is a correctness property, not a rate limit, so it is read
 * and enforced under a row lock: two concurrent changes cannot both see an
 * old `handle_changed_at` and both succeed. The timestamp itself is stamped by
 * a trigger (026), so no code path can forget it. Choosing a handle for the
 * first time is always allowed.
 */
export async function setHandle(
  app: GwcApp,
  { memberId, handle: raw, signal }: { memberId: string; handle: string; signal?: AbortSignal },
) {
  const handle = normaliseHandle(raw)
  const problem = shapeProblem(handle)
  if (problem) throw fieldError('handle', problem)

  await withTransaction(app.pg, async (client) => {
    const { rows } = await client.query(
      `SELECT handle, handle_changed_at,
              handle_changed_at > now() - make_interval(days => $2) AS too_soon
         FROM members WHERE id = $1 FOR UPDATE`,
      [memberId, HANDLE_CHANGE_DAYS],
    )
    const current = rows[0]
    if (!current) throw refuse(PROBLEMS.NOT_FOUND, 'No such member.')
    if (current.handle && String(current.handle).toLowerCase() === handle) return
    if (current.handle && current.too_soon) {
      throw refuse(PROBLEMS.HANDLE_CHANGE_TOO_SOON,
        `A handle can be changed once every ${HANDLE_CHANGE_DAYS} days.`)
    }
    try {
      await client.query('UPDATE members SET handle = $2 WHERE id = $1', [memberId, handle])
    } catch (err) {
      // The unique constraint is the arbiter under concurrency; the message is
      // the same as for a reserved handle, for the reason isHandleAvailable
      // gives.
      if ((err as { code?: string }).code === '23505') {
        throw fieldError('handle', 'That handle is not available.')
      }
      throw err
    }
  }, { signal })
}
