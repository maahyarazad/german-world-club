import { PROBLEMS } from '@gwc/contracts/errors'
import { query } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { MemberOffer } from '@gwc/contracts/offers'
import type { GwcApp } from '../../../app.ts'

/**
 * Member offers (feature 011, research R11).
 *
 * **`VISIBLE_OFFER` is the single rule for "a member may see this offer"**,
 * shared by `GET /member/offers/:id` and the push dispatcher, which re-checks
 * it before announcing an offer (FR-023). One copy, so a notification can
 * never point at an offer the screen then refuses to show, or announce one the
 * screen would have hidden.
 *
 * Visible means: published, inside its validity window right now, from an
 * organisation that is active and has a public face. The last two are the same
 * conditions the organisation's own public profile applies — a member should
 * not be sent to an offer from a merchant whose page answers 404.
 *
 * **Scope contract.** Refers to `o` (offers), `org` (organisations) and `op`
 * (organisation_profiles), joined on the organisation id.
 */
export const VISIBLE_OFFER = `
      o.state = 'published'
  AND now() >= o.valid_from AND now() < o.valid_until
  AND org.status = 'active'
  AND op.display_name IS NOT NULL`

export const OFFER_JOINS = `
  JOIN organisations org ON org.id = o.organisation_id
  JOIN organisation_profiles op ON op.organisation_id = o.organisation_id`

/**
 * One offer as a member sees it, or the standard 404.
 *
 * A draft, a withdrawn offer, one not yet valid and one that no longer exists
 * all answer identically (Principle III): the response must not tell a member
 * which offers a merchant is preparing.
 */
export async function getMemberOffer(
  app: GwcApp,
  { id, signal }: { id: string; signal?: AbortSignal },
): Promise<MemberOffer> {
  const { rows } = await query(
    app.pg,
    `SELECT o.id, o.title, o.description, o.benefit_kind, o.benefit_value,
            o.regular_price_cents, o.member_price_cents, o.currency,
            o.valid_from, o.valid_until, o.conditions,
            op.display_name, org.slug, op.logo_asset_id
       FROM offers o
       ${OFFER_JOINS}
      WHERE o.id = $1 AND ${VISIBLE_OFFER}`,
    [id],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such offer.')

  const logo = row.logo_asset_id
    ? (await loadMediaItems(app.pg, [String(row.logo_asset_id)])).get(String(row.logo_asset_id)) ?? null
    : null

  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description ?? null,
    benefit: {
      kind: row.benefit_kind,
      // numeric arrives as a string from pg; the contract says number.
      value: row.benefit_value === null ? null : Number(row.benefit_value),
    },
    regularPriceCents: row.regular_price_cents ?? null,
    memberPriceCents: row.member_price_cents ?? null,
    currency: String(row.currency).trim(),
    validFrom: new Date(row.valid_from).toISOString(),
    validUntil: new Date(row.valid_until).toISOString(),
    conditions: row.conditions ?? null,
    merchant: { displayName: String(row.display_name), slug: String(row.slug), logo },
  }
}
