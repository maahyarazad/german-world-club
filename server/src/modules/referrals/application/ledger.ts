import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { iso, REFEREE_NAME } from './read-model.ts'
import type { XpEntry, XpRate } from '@gwc/contracts/referrals'
import type { GwcApp } from '../../../app.ts'

/**
 * What staff may do to referrals and XP (US4, research R12). Three actions,
 * each with a reason, each audited — and none of them edits anything:
 *
 *   - reversing an award ADDS a cancelling entry; the award stays visible;
 *   - disabling a link moves it to a final state; its referrals stay;
 *   - changing the rate ADDS a rate row; earlier awards keep their amount.
 *
 * The triggers in 040_referrals.sql would refuse an edit anyway. These
 * functions answer the business cases (already reversed, already disabled,
 * your own record) cleanly before the database has to.
 *
 * Never on one's own record: every staff member earns XP (spec Q2), so a staff
 * member reversing or disabling their OWN would be deciding about their own
 * money — in either direction. Refused against the loaded row, inside the
 * transaction, because a route-level posture cannot express "yours"
 * (Principle II).
 */

const isOwn = (row: { owner_kind: string; owner_id: string }, adminId: string) =>
  row.owner_kind === 'admin' && String(row.owner_id) === adminId

export async function reverseAward(
  app: GwcApp,
  { entryId, adminId, reason, requestId }: { entryId: string; adminId: string; reason: string; requestId?: string },
): Promise<XpEntry> {
  const created = await withTransaction(app.pg, async (client) => {
    // FOR UPDATE: two staff members reversing the same award at once
    // serialise here, and the second finds the first one's reversal.
    const { rows: [award] } = await client.query(
      `SELECT e.id, e.kind, e.owner_kind, e.owner_id, e.amount, e.referral_id
         FROM xp_entries e WHERE e.id = $1 FOR UPDATE`,
      [entryId],
    )
    if (!award) throw refuse(PROBLEMS.NOT_FOUND, 'No such XP entry.')
    if (isOwn(award, adminId)) throw refuse(PROBLEMS.INSUFFICIENT_PERMISSION, 'You cannot change your own XP.')
    if (award.kind !== 'award') throw refuse(PROBLEMS.CONFLICT, 'Only an award can be reversed.')
    const { rows: [existing] } = await client.query('SELECT 1 FROM xp_entries WHERE reverses_entry_id = $1', [entryId])
    if (existing) throw refuse(PROBLEMS.CONFLICT, 'This award has already been reversed.')

    const { rows: [reversal] } = await client.query(
      `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, reverses_entry_id, reason, created_by)
       VALUES ($1, $2, 'reversal', $3, $4, $5, $6, $7)
       RETURNING id, kind, amount, reason, referral_id, reverses_entry_id, created_at`,
      [award.owner_kind, award.owner_id, -Number(award.amount), award.referral_id, entryId, reason.trim(), adminId],
    )
    const { rows: [named] } = await client.query(
      `SELECT ${REFEREE_NAME} AS referee_name
         FROM referrals r JOIN members m ON m.id = r.referee_member_id WHERE r.id = $1`,
      [award.referral_id],
    )
    return { reversal, refereeName: String(named?.referee_name ?? '—') }
  })

  await app.audit({
    action: 'xp_reversed', requestId, actorId: adminId, actorKind: 'admin',
    targetType: 'xp_entry', targetId: created.reversal.id,
    detail: { reason: reason.trim(), xp: Number(created.reversal.amount), entryId },
  })

  const r = created.reversal
  return {
    id: String(r.id), kind: 'reversal', amount: Number(r.amount), reason: String(r.reason),
    referralId: String(r.referral_id), refereeName: created.refereeName,
    reversesEntryId: String(r.reverses_entry_id), reversed: false, createdAt: iso(r.created_at)!,
  }
}

export async function disableLink(
  app: GwcApp,
  { linkId, adminId, reason, requestId }: { linkId: string; adminId: string; reason: string; requestId?: string },
): Promise<{ id: string; state: 'disabled' }> {
  await withTransaction(app.pg, async (client) => {
    const { rows: [link] } = await client.query(
      'SELECT id, state, owner_kind, owner_id FROM referral_links WHERE id = $1 FOR UPDATE',
      [linkId],
    )
    if (!link) throw refuse(PROBLEMS.NOT_FOUND, 'No such referral link.')
    if (isOwn(link, adminId)) throw refuse(PROBLEMS.INSUFFICIENT_PERMISSION, 'You cannot disable your own referral link.')
    if (link.state !== 'active') throw refuse(PROBLEMS.CONFLICT, 'This referral link is no longer active.')
    await client.query(
      `UPDATE referral_links
          SET state = 'disabled', state_changed_at = now(), disabled_by = $2, disabled_reason = $3
        WHERE id = $1`,
      [linkId, adminId, reason.trim()],
    )
  })
  await app.audit({
    action: 'referral_link_disabled', requestId, actorId: adminId, actorKind: 'admin',
    targetType: 'referral_link', targetId: linkId, detail: { reason: reason.trim() },
  })
  return { id: linkId, state: 'disabled' }
}

/**
 * A new rate from now on (FR-013). Not "own record" guarded: a rate applies to
 * everybody, staff included, and that is what the audit row is for.
 */
export async function setRate(
  app: GwcApp,
  { xp, adminId, reason, requestId }: { xp: number; adminId: string; reason: string; requestId?: string },
): Promise<XpRate> {
  const { rows: [row] } = await app.pg.query(
    `WITH inserted AS (
       INSERT INTO referral_xp_rates (xp, set_by, reason) VALUES ($1, $2, $3)
       RETURNING xp, effective_from, set_by, reason)
     SELECT i.xp, i.effective_from, i.reason, a.display_name AS set_by_name
       FROM inserted i LEFT JOIN admin_users a ON a.id = i.set_by`,
    [xp, adminId, reason.trim()],
  )
  await app.audit({
    action: 'xp_rate_changed', requestId, actorId: adminId, actorKind: 'admin',
    targetType: 'referral_xp_rate', detail: { reason: reason.trim(), xp },
  })
  return { xp: Number(row.xp), effectiveFrom: iso(row.effective_from)!, setBy: row.set_by_name ?? null, reason: String(row.reason) }
}
