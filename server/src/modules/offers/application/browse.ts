import type { OfferListItem, BrowseCategory } from '@gwc/contracts/offers'
import { query } from '../../../db/query.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import { VISIBLE_OFFER, OFFER_JOINS } from './offer.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * Browsing merchant offers (feature 035), the same for every kind of account.
 *
 * Everything goes through `VISIBLE_OFFER`, the one rule for "an account may see
 * this offer": published, in its window, from an active organisation with a
 * public name, in a store that is switched on. A deactivated store's offers are
 * therefore absent from the list as well as from the detail and from redeeming,
 * on the next request.
 *
 * Lists carry the lead image as a derivative (a video's poster) and never an
 * original.
 */

const PAGE = 20

type Cursor = { at: string; id: string }
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url')
const decode = (raw: string | undefined): Cursor | null => {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    return typeof parsed?.at === 'string' && typeof parsed?.id === 'string' ? parsed : null
  } catch {
    return null
  }
}

export async function listVisibleOffers(
  app: GwcApp,
  { categoryId, cursor, signal }: { categoryId?: string; cursor?: string; signal?: AbortSignal },
) {
  const after = decode(cursor)
  const { rows } = await query(
    app.pg,
    `SELECT o.id, o.title, o.benefit_kind, o.benefit_value, o.currency, o.valid_until, o.category_id,
            o.remaining, o.published_at, op.display_name, org.slug, op.logo_asset_id,
            (SELECT m.asset_id FROM offer_media m WHERE m.offer_id = o.id ORDER BY m.position LIMIT 1) AS lead_asset_id
       FROM offers o
       ${OFFER_JOINS}
      WHERE ${VISIBLE_OFFER}
        AND ($1::uuid IS NULL OR o.category_id = $1)
        AND ($2::timestamptz IS NULL OR (o.published_at, o.id) < ($2::timestamptz, $3::uuid))
      ORDER BY o.published_at DESC, o.id DESC
      LIMIT ${PAGE + 1}`,
    [categoryId ?? null, after?.at ?? null, after?.id ?? null],
    { signal },
  )

  const page = rows.slice(0, PAGE)
  const assetIds = page.flatMap((r) => [r.lead_asset_id, r.logo_asset_id].filter(Boolean).map(String))
  const items = await loadMediaItems(app.pg, assetIds)

  const list: OfferListItem[] = page.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    benefit: { kind: r.benefit_kind, value: r.benefit_value === null ? null : Number(r.benefit_value) },
    currency: String(r.currency).trim(),
    validUntil: new Date(r.valid_until).toISOString(),
    categoryId: String(r.category_id),
    // Shown, not hidden: a sold-out offer is still on the list, as sold out.
    soldOut: r.remaining !== null && r.remaining <= 0,
    thumbnail: r.lead_asset_id ? items.get(String(r.lead_asset_id)) ?? null : null,
    merchant: {
      displayName: String(r.display_name),
      slug: String(r.slug),
      logo: r.logo_asset_id ? items.get(String(r.logo_asset_id)) ?? null : null,
    },
  }))

  const last = page[page.length - 1]
  return {
    items: list,
    nextCursor: rows.length > PAGE && last ? encode({ at: new Date(last.published_at).toISOString(), id: String(last.id) }) : null,
  }
}

/**
 * The categories to browse by, each with how many offers are visible in it now.
 *
 * A category staff have hidden still appears while it has visible offers — they
 * stay visible and redeemable, so people must be able to find them — and
 * disappears once it has none. A visible category with no offers is still
 * listed, with a count of zero.
 */
export async function listBrowseCategories(app: GwcApp, { signal }: { signal?: AbortSignal } = {}) {
  const { rows } = await query(
    app.pg,
    `SELECT c.id, c.slug, c.name_de, c.name_en, c.position, c.visible, count(v.id)::int AS offer_count
       FROM offer_categories c
       LEFT JOIN (
         SELECT o.id, o.category_id
           FROM offers o
           ${OFFER_JOINS}
          WHERE ${VISIBLE_OFFER}
       ) v ON v.category_id = c.id
      GROUP BY c.id, c.slug, c.name_de, c.name_en, c.position, c.visible
     HAVING c.visible OR count(v.id) > 0
      ORDER BY c.position, c.slug`,
    [],
    { signal },
  )
  const items: BrowseCategory[] = rows.map((r) => ({
    id: String(r.id), slug: String(r.slug), nameDe: String(r.name_de), nameEn: String(r.name_en),
    offerCount: Number(r.offer_count),
  }))
  return { items }
}
