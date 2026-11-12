import { randomInt } from 'node:crypto'
import {
  REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH, normaliseReferralCode,
} from '@gwc/contracts/referrals'
import type { ReferralOwnerKind } from '@gwc/contracts/referrals'

/**
 * Referral codes: minting them, and turning one somebody typed or tapped into
 * the link it names (research R7, R8).
 */

/** Anything with `query` — the pool, or a client inside a transaction. */
export type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> }

export type Owner = { kind: ReferralOwnerKind; id: string }

export type ActiveLink = { linkId: string; ownerKind: ReferralOwnerKind; ownerId: string }

/**
 * Eight characters from a CSPRNG over the Crockford alphabet: 32⁸ ≈ 1.1 × 10¹²
 * codes. A club of thousands holds a vanishing fraction of them, which is what
 * makes guessing a valid one at the public page's rate limit hopeless (SC-006).
 * `Math.random` would make them predictable from a few observed codes.
 */
export function generateCode(): string {
  let code = ''
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) code += REFERRAL_CODE_ALPHABET[randomInt(REFERRAL_CODE_ALPHABET.length)]
  return code
}

const MAX_CODE_ATTEMPTS = 5

/**
 * Insert an active link with a fresh code, retrying on the (astronomically
 * rare) collision with a code ever issued before. A conflict on the
 * one-active-link index is NOT retried here: it means the owner already has a
 * link, which the caller resolves by reading it.
 */
export async function insertLinkWithFreshCode(db: Queryable, owner: Owner): Promise<{ id: string; code: string; created_at: Date }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { rows } = await db.query(
        `INSERT INTO referral_links (owner_kind, owner_id, code) VALUES ($1, $2, $3)
         RETURNING id, code, created_at`,
        [owner.kind, owner.id, generateCode()],
      )
      return rows[0]
    } catch (err) {
      const e = err as { code?: string; constraint?: string }
      if (e.code === '23505' && e.constraint === 'referral_links_code_key' && attempt < MAX_CODE_ATTEMPTS) continue
      throw err
    }
  }
}

/**
 * The SQL condition "this link's owner can still sign in", for a link aliased
 * `l`. One copy, used by the landing page, registration and attribution alike:
 * a locked member's link, a suspended partner's, a deactivated staff member's
 * all stop working the moment the account does (FR-006, R2).
 */
export const OWNER_IS_ACTIVE = `
  CASE l.owner_kind
    WHEN 'member' THEN EXISTS (
      SELECT 1 FROM members m WHERE m.id = l.owner_id AND m.status = 'active')
    WHEN 'admin' THEN EXISTS (
      SELECT 1 FROM admin_users a WHERE a.id = l.owner_id AND a.is_active)
    ELSE EXISTS (
      SELECT 1 FROM organisation_users u JOIN organisations o ON o.id = u.organisation_id
       WHERE u.id = l.owner_id AND u.status = 'active' AND o.status = 'active')
  END`

/**
 * The live link a code names, or `null`.
 *
 * `null` covers five different situations — malformed, unknown, replaced,
 * disabled by staff, owner no longer active — and callers must not be able to
 * tell them apart, because whatever they do with the difference would show it
 * to whoever typed the code (FR-006, SC-006).
 */
export async function resolveActiveLink(db: Queryable, rawCode: string | null | undefined): Promise<ActiveLink | null> {
  const code = normaliseReferralCode(rawCode)
  if (!code) return null
  const { rows } = await db.query(
    `SELECT l.id, l.owner_kind, l.owner_id
       FROM referral_links l
      WHERE l.code = $1 AND l.state = 'active' AND ${OWNER_IS_ACTIVE}`,
    [code],
  )
  return toActiveLink(rows[0])
}

/** The same test by id: attribution re-checks the link an application brought (R2). */
export async function resolveActiveLinkById(db: Queryable, linkId: string): Promise<ActiveLink | null> {
  const { rows } = await db.query(
    `SELECT l.id, l.owner_kind, l.owner_id
       FROM referral_links l
      WHERE l.id = $1 AND l.state = 'active' AND ${OWNER_IS_ACTIVE}`,
    [linkId],
  )
  return toActiveLink(rows[0])
}

function toActiveLink(row: Record<string, unknown> | undefined): ActiveLink | null {
  if (!row) return null
  return { linkId: String(row.id), ownerKind: row.owner_kind as ReferralOwnerKind, ownerId: String(row.owner_id) }
}
