import { query } from '../../../db/query.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Who a notification may reach — **the single copy of this rule** (feature
 * 011, data-model.md "Audience query").
 *
 * Like `VISIBLE_POST` in threads, this is one SQL fragment every caller
 * imports. The broadcast confirm dialog (`GET /push/audience`), the
 * dispatcher's materialisation and its per-batch re-check all use it, so the
 * number staff confirm is the number the send reaches, and a member locked
 * mid-broadcast stops receiving at the next batch. A second copy is how those
 * three drift apart.
 *
 * A device is eligible when:
 *   - it is enabled and no provider has reported its token dead
 *   - its member is `active`
 *   - its member has no application, or an `approved` one — the same gate
 *     10-auth applies on every route (research R4), repeated here because a
 *     device registered before a status change must not keep receiving
 *   - for `test`: the member is on the rehearsal list. Preferences are ignored
 *     there, because test users agreed to be rehearsed on (R13)
 *   - for `broadcasts` / `offers`: the member hasn't switched that kind off.
 *     No preference row means on.
 *
 * **Scope contract.** The fragment refers to `d` (a `push_devices` row) and
 * `n.audience` (`'test' | 'broadcasts' | 'offers'`). Callers bring both into
 * scope; `countAudience` below shows the form for a bare audience.
 */
export const ELIGIBLE_DEVICE = `
      d.enabled
  AND d.disabled_reason IS NULL
  AND length(btrim(d.token)) > 0
  AND EXISTS (
        SELECT 1 FROM members em
         WHERE em.id = d.member_id AND em.status = 'active')
  AND NOT EXISTS (
        SELECT 1 FROM membership_applications ea
         WHERE ea.member_id = d.member_id AND ea.state <> 'approved')
  AND CASE n.audience
        WHEN 'test' THEN EXISTS (
          SELECT 1 FROM push_test_recipients et WHERE et.member_id = d.member_id)
        WHEN 'broadcasts' THEN COALESCE(
          (SELECT ep.broadcasts FROM member_push_preferences ep WHERE ep.member_id = d.member_id), true)
        WHEN 'offers' THEN COALESCE(
          (SELECT ep.offers FROM member_push_preferences ep WHERE ep.member_id = d.member_id), true)
        ELSE false
      END`

export type PushAudienceName = 'test' | 'broadcasts' | 'offers'

/** The console speaks of rehearsals and broadcasts; the table of audiences. */
export const AUDIENCE_FOR_KIND = Object.freeze({
  rehearsal: 'test',
  broadcast: 'broadcasts',
  offer: 'offers',
} as const)

/** How many members and devices a notification to `audience` would reach right now. */
export async function countAudience(
  app: GwcApp,
  { audience, signal }: { audience: PushAudienceName; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `SELECT count(DISTINCT d.member_id)::int AS members, count(*)::int AS devices
       FROM push_devices d
      CROSS JOIN (SELECT $1::text AS audience) n
      WHERE ${ELIGIBLE_DEVICE}`,
    [audience],
    { signal },
  )
  return { members: rows[0]?.members ?? 0, devices: rows[0]?.devices ?? 0 }
}
