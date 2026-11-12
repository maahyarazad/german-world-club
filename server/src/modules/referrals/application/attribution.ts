import { resolveActiveLinkById } from './codes.ts'
import type { Queryable, Owner } from './codes.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Recording a referral (US2, research R1–R4).
 *
 * Called from `/onboarding/verify-mobile`, inside the transaction that sets
 * `members.mobile_verified_at` — and only when that update actually set it.
 * NOT from `/onboarding/register`: register creates the account before any
 * proof (the SMS code has only been *sent*), so recording there would pay XP
 * for any phone number anybody typed into the form. Verification is the first
 * moment the account is proven to hold a real, reachable phone, which is what
 * "registration is complete" means in this feature (spec FR-007).
 *
 * The referral and its award are written together or not at all (FR-010). Both
 * inserts are guarded by unique constraints rather than by a prior SELECT, so
 * a retried or concurrent verification lands on the constraint and writes
 * nothing — the referee's member id is the deterministic reference
 * (Principle IV).
 */

export type AttributionOutcome =
  | { kind: 'none' }
  | { kind: 'recorded'; referralId: string; entryId: string; xp: number; owner: Owner; linkId: string }
  | { kind: 'refused'; reason: 'self-referral' | 'link-inactive'; linkId: string }

export async function recordReferral(client: Queryable, memberId: string): Promise<AttributionOutcome> {
  const { rows: [application] } = await client.query(
    'SELECT pending_referral_link_id FROM membership_applications WHERE member_id = $1',
    [memberId],
  )
  const pendingLinkId = application?.pending_referral_link_id ? String(application.pending_referral_link_id) : null
  if (!pendingLinkId) return { kind: 'none' }

  // Re-checked now, not trusted from register time (R2): a link staff disabled,
  // or whose owner was locked, in the minutes since must not pay for the
  // applications already in flight.
  const link = await resolveActiveLinkById(client, pendingLinkId)
  if (!link) return { kind: 'refused', reason: 'link-inactive', linkId: pendingLinkId }

  const owner: Owner = { kind: link.ownerKind, id: link.ownerId }
  if (await isSelfReferral(client, memberId, owner)) {
    return { kind: 'refused', reason: 'self-referral', linkId: link.linkId }
  }

  const { rows: [referral] } = await client.query(
    `INSERT INTO referrals (link_id, referrer_kind, referrer_id, referee_member_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (referee_member_id) DO NOTHING
     RETURNING id`,
    [link.linkId, owner.kind, owner.id, memberId],
  )
  // Already recorded by an earlier or concurrent verification: nothing more to do.
  if (!referral) return { kind: 'none' }

  // The rate in force at this moment, copied onto the entry (FR-013, R11): a
  // later change of rate never rewrites what was already earned.
  const { rows: [entry] } = await client.query(
    `INSERT INTO xp_entries (owner_kind, owner_id, kind, amount, referral_id, rate_id, reason)
     SELECT $1, $2, 'award', r.xp, $3, r.id, 'referral'
       FROM referral_xp_rates r
      ORDER BY r.effective_from DESC, r.id DESC
      LIMIT 1
     RETURNING id, amount`,
    [owner.kind, owner.id, referral.id],
  )
  if (!entry) {
    // The migration writes an initial rate and nothing deletes rates, so this
    // is a broken database rather than a business case. Rolling the referral
    // back with it keeps "a referral and its award, or neither" true.
    throw new Error('no XP rate is in force; a referral cannot be recorded without one')
  }

  return {
    kind: 'recorded',
    referralId: String(referral.id),
    entryId: String(entry.id),
    xp: Number(entry.amount),
    owner,
    linkId: link.linkId,
  }
}

/**
 * Whether the new member is the link's owner under another account (R3).
 *
 * Staff and organisation users live in their own tables, so nothing stops
 * them registering a member account with their own address — and the email is
 * what they would share. Members also have a mobile number, and the new account
 * has a proven one by now. A match is refused silently: the applicant's
 * responses are identical either way, so registration cannot be used to test
 * whether an address belongs to a code's owner.
 */
async function isSelfReferral(client: Queryable, memberId: string, owner: Owner): Promise<boolean> {
  const ownerContact =
    owner.kind === 'member'
      ? 'SELECT email::text AS email, mobile FROM members WHERE id = $2'
      : owner.kind === 'admin'
        ? 'SELECT email::text AS email, NULL::text AS mobile FROM admin_users WHERE id = $2'
        : 'SELECT email::text AS email, NULL::text AS mobile FROM organisation_users WHERE id = $2'
  const { rows } = await client.query(
    `WITH referee AS (SELECT lower(email::text) AS email, mobile FROM members WHERE id = $1),
          owner AS (${ownerContact})
     SELECT EXISTS (
       SELECT 1 FROM referee, owner
        WHERE referee.email = lower(owner.email)
           OR (owner.mobile IS NOT NULL AND referee.mobile = owner.mobile)
     ) AS same`,
    [memberId, owner.id],
  )
  return rows[0]?.same === true
}

/**
 * The audit rows for an outcome, written after the transaction commits — the
 * audit writer has its own connection, and a row describing a referral that
 * then rolled back would be evidence of something that never happened.
 */
export async function auditAttribution(
  app: GwcApp,
  outcome: AttributionOutcome,
  { memberId, requestId }: { memberId: string; requestId?: string },
) {
  if (outcome.kind === 'recorded') {
    await app.audit({
      action: 'referral_recorded', requestId,
      actorId: memberId, actorKind: 'member',
      targetType: 'referral', targetId: outcome.referralId,
      detail: { linkId: outcome.linkId },
    })
    await app.audit({
      action: 'xp_awarded', requestId,
      targetType: 'xp_entry', targetId: outcome.entryId,
      detail: { xp: outcome.xp, referralId: outcome.referralId },
    })
  } else if (outcome.kind === 'refused') {
    await app.audit({
      action: 'referral_refused', outcome: 'denied', requestId,
      actorId: memberId, actorKind: 'member',
      targetType: 'member', targetId: memberId,
      detail: { reason: outcome.reason, linkId: outcome.linkId },
    })
  }
}
