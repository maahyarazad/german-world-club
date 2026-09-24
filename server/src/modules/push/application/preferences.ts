import { query } from '../../../db/query.ts'
import type { Preferences } from '@gwc/contracts/push'
import type { GwcApp } from '../../../app.ts'

/**
 * Which kinds of notification a member wants (feature 011, research R13).
 *
 * Enforced by the server, in `ELIGIBLE_DEVICE`, not by the app hiding what
 * arrives (FR-006). No row means both on: a member who never opened the
 * settings screen has not opted out of anything.
 */
export async function getPreferences(
  app: GwcApp,
  { memberId, signal }: { memberId: string; signal?: AbortSignal },
): Promise<Preferences> {
  const { rows } = await query(
    app.pg,
    'SELECT offers, broadcasts FROM member_push_preferences WHERE member_id = $1',
    [memberId],
    { signal },
  )
  return { offers: rows[0]?.offers ?? true, broadcasts: rows[0]?.broadcasts ?? true }
}

export async function putPreferences(
  app: GwcApp,
  { memberId, offers, broadcasts, signal }: Preferences & { memberId: string; signal?: AbortSignal },
): Promise<Preferences> {
  const { rows } = await query(
    app.pg,
    `INSERT INTO member_push_preferences (member_id, offers, broadcasts)
     VALUES ($1, $2, $3)
     ON CONFLICT (member_id) DO UPDATE
       SET offers = EXCLUDED.offers, broadcasts = EXCLUDED.broadcasts, updated_at = now()
     RETURNING offers, broadcasts`,
    [memberId, offers, broadcasts],
    { signal },
  )
  const row = rows[0]!
  return { offers: row.offers, broadcasts: row.broadcasts }
}
