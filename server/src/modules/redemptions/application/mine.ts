import type { Redemption } from '@gwc/contracts/redemptions'
import { query } from '../../../db/query.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { Redeemer } from './redeem.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * The redeemed items of one account (feature 035, FR-020): a member's own, a
 * merchant user's own, a partner's, a staff member's. A person sees only what
 * they redeemed themselves — the organisation-wide and platform-wide views are
 * the reports, which have their own scope rules.
 *
 * Kept even when the offer has since been withdrawn or its store switched off:
 * a redemption is history, and its reference is still what the person shows.
 * Newest first, keyset-paged on (redeemed_at, id).
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

export async function listOwnRedemptions(
  app: GwcApp,
  { redeemer, cursor, signal }: { redeemer: Redeemer; cursor?: string; signal?: AbortSignal },
) {
  const after = decode(cursor)
  const { rows } = await query(
    app.pg,
    `SELECT r.id, r.reference, r.redeemed_at, o.id AS offer_id, o.title, op.display_name,
            (SELECT m.asset_id FROM offer_media m WHERE m.offer_id = o.id ORDER BY m.position LIMIT 1) AS lead_asset_id
       FROM redemptions r
       JOIN offers o ON o.id = r.offer_id
       LEFT JOIN organisation_profiles op ON op.organisation_id = o.organisation_id
      WHERE r.redeemer_kind = $1::account_kind AND r.redeemer_id = $2
        AND ($3::timestamptz IS NULL OR (r.redeemed_at, r.id) < ($3::timestamptz, $4::uuid))
      ORDER BY r.redeemed_at DESC, r.id DESC
      LIMIT ${PAGE + 1}`,
    [redeemer.kind, redeemer.id, after?.at ?? null, after?.id ?? null],
    { signal },
  )

  const page = rows.slice(0, PAGE)
  const items = await loadMediaItems(app.pg, page.filter((r) => r.lead_asset_id).map((r) => String(r.lead_asset_id)))
  const list: Redemption[] = page.map((r) => {
    const lead = r.lead_asset_id ? items.get(String(r.lead_asset_id)) : null
    return {
      id: String(r.id),
      reference: String(r.reference),
      redeemedAt: new Date(r.redeemed_at).toISOString(),
      offerId: String(r.offer_id),
      offerTitle: String(r.title),
      merchantName: r.display_name ?? null,
      thumbnailUrl: lead?.variants.find((v) => v.variant === 'thumb')?.url ?? lead?.posterUrl ?? null,
    }
  })

  const last = page[page.length - 1]
  return {
    items: list,
    nextCursor: rows.length > PAGE && last ? encode({ at: new Date(last.redeemed_at).toISOString(), id: String(last.id) }) : null,
  }
}
