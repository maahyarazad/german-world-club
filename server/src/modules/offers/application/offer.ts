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
 * organisation that is active and has a public face, and from a store that is
 * switched on (feature 035). The organisation conditions are the same ones the
 * organisation's own public profile applies — a member should not be sent to an
 * offer from a merchant whose page answers 404. The store condition is how
 * staff deactivating a store takes every one of its offers out of sight at once,
 * on the next request, in browse, detail, redeem, push and the landing page.
 *
 * **Scope contract.** Refers to `o` (offers), `org` (organisations), `op`
 * (organisation_profiles) and `st` (stores), joined on the organisation id and
 * the offer's store. Anything using `VISIBLE_OFFER` must use `OFFER_JOINS`.
 *
 * "Sold out" is deliberately NOT part of it: a sold-out offer still shows, as
 * sold out, and only redeeming it is refused.
 */
export const VISIBLE_OFFER = `
      o.state = 'published'
  AND now() >= o.valid_from AND now() < o.valid_until
  AND org.status = 'active'
  AND op.display_name IS NOT NULL
  AND st.active`

export const OFFER_JOINS = `
  JOIN organisations org ON org.id = o.organisation_id
  JOIN organisation_profiles op ON op.organisation_id = o.organisation_id
  JOIN stores st ON st.id = o.store_id`

/**
 * **`LEAD_OFFER_ASSET` is the single rule for "the picture an offer leads with"**
 * (feature 042, research R7): the first item of its media, by position, whose
 * asset is `ready`.
 *
 * The list card, the detail's first item and a redemption's thumbnail all use it,
 * so they cannot disagree. Before it existed three queries each wrote the shorter
 * form (`ORDER BY position LIMIT 1`) and took the first row whatever the asset's
 * state, while the detail dropped assets that were not ready: a merchant whose
 * first video was still processing saw no picture on the card and a different one
 * first on the detail. A second copy is how that happens again.
 *
 * **Scope contract.** Refers to `o` (offers).
 */
export const LEAD_OFFER_ASSET = `(
  SELECT m.asset_id
    FROM offer_media m
    JOIN assets a ON a.id = m.asset_id AND a.state = 'ready'
   WHERE m.offer_id = o.id
   ORDER BY m.position
   LIMIT 1)`

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
            o.valid_from, o.valid_until, o.conditions, o.per_person_limit,
            c.id AS category_id, c.slug AS category_slug, c.name_de, c.name_en,
            op.display_name, org.slug, op.logo_asset_id
       FROM offers o
       ${OFFER_JOINS}
       JOIN offer_categories c ON c.id = o.category_id
      WHERE o.id = $1 AND ${VISIBLE_OFFER}`,
    [id],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such offer.')

  // The offer's own images and videos, in order, derivatives only. An item that
  // is not `ready` yet is not returned by the loader and simply does not appear.
  const { rows: links } = await query(
    app.pg,
    'SELECT asset_id FROM offer_media WHERE offer_id = $1 ORDER BY position',
    [id],
    { signal },
  )
  const assetIds = links.map((l) => String(l.asset_id))
  if (row.logo_asset_id) assetIds.push(String(row.logo_asset_id))
  const items = await loadMediaItems(app.pg, assetIds)
  const logo = row.logo_asset_id ? items.get(String(row.logo_asset_id)) ?? null : null
  const media = links.flatMap((l) => items.get(String(l.asset_id)) ?? [])

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
    perPersonLimit: row.per_person_limit ?? null,
    category: { id: String(row.category_id), slug: String(row.category_slug), nameDe: String(row.name_de), nameEn: String(row.name_en) },
    media,
    merchant: { displayName: String(row.display_name), slug: String(row.slug), logo },
  }
}
