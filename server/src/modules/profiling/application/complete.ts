import { withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { PROBLEMS } from '@gwc/contracts/errors'
import { profilingMissing } from '@gwc/contracts/profiling'
import { loadProfilingStatus } from './status.ts'
import type { GwcApp } from '../../../app.ts'
import type { PoolClient } from 'pg'
import type { ProfilingStatus } from '@gwc/contracts/profiling'

/**
 * `POST /profiling/submit` — the only writer of `completed_at` (research R10).
 *
 * Completeness is decided by the same `profilingMissing` the clients use to
 * decide what to show, against the row as stored — never against anything the
 * request says. For the elsewhere branch the outcome follows the GWC match
 * stored when the cities were saved.
 */
export async function completeProfiling(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<ProfilingStatus> {
  await withTransaction(app.pg, async (client: PoolClient) => {
    const locked = await client.query(
      'SELECT branch, completed_at FROM member_profiling WHERE member_id = $1 FOR UPDATE',
      [memberId],
    )
    const row = locked.rows[0] as { branch: 'germany' | 'elsewhere'; completed_at: string | null } | undefined

    // No row means nothing was answered; the status read below reports the
    // branch and every step as missing.
    const status = await loadProfilingStatus(app, { memberId, signal })
    if (row?.completed_at) {
      throw forbidden(PROBLEMS.CONFLICT, 'Profiling is already complete and cannot be changed.')
    }
    const missing = profilingMissing(status.branch, status.answers)
    if (!row || missing.length > 0) {
      throw forbidden(
        PROBLEMS.PROFILING_ANSWERS_MISSING,
        `Unanswered: ${(row ? missing : profilingMissing(status.branch, status.answers)).join(', ')}.`,
      )
    }

    if (row.branch === 'elsewhere') {
      // The match was stored when the cities were saved (it decides whether Q6
      // is asked), so the outcome only reads it — nothing is looked up here.
      await client.query(
        `UPDATE member_profiling
            SET outcome = CASE WHEN matched_gwc_city_id IS NULL THEN 'in_person_meeting' ELSE 'gwc_city_match' END,
                completed_at = now()
          WHERE member_id = $1`,
        [memberId],
      )
    } else {
      await client.query('UPDATE member_profiling SET completed_at = now() WHERE member_id = $1', [memberId])
    }
  }, { signal })

  return loadProfilingStatus(app, { memberId, signal })
}
