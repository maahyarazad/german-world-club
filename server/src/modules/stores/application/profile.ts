import { PROBLEMS } from '@gwc/contracts/errors'
import type { StoreProfile } from '@gwc/contracts/stores'
import { query } from '../../../db/query.ts'
import { forbidden as refuse } from '../../../authz/require-permission.ts'
import { loadMediaItems } from '../../media/application/media-items.ts'
import type { GwcApp } from '../../../app.ts'

/**
 * A merchant's store as another account sees it: the page an offer links to.
 *
 * It applies the same conditions `VISIBLE_OFFER` applies to an offer — the
 * organisation is active, has a public name, and the store is switched on — so a
 * store staff deactivated disappears from here on the next request, together
 * with its offers, and answers the same 404 as a slug that never existed. A
 * different answer would confirm that the merchant exists.
 *
 * Columns are named, never `SELECT *`: `organisations` holds contract data
 * (`legal_name`, `fee_tier`) that must not be one column away from a response.
 */
export async function getVisibleStore(
  app: GwcApp,
  { slug, signal }: { slug: string; signal?: AbortSignal },
): Promise<StoreProfile> {
  const { rows } = await query(
    app.pg,
    `SELECT st.id, st.description, st.opening_hours, st.cover_asset_id,
            org.slug, op.display_name, op.logo_asset_id
       FROM stores st
       JOIN organisations org ON org.id = st.organisation_id
       JOIN organisation_profiles op ON op.organisation_id = st.organisation_id
      WHERE org.slug = $1
        AND org.status = 'active'
        AND op.display_name IS NOT NULL
        AND st.active`,
    [slug],
    { signal },
  )
  const row = rows[0]
  if (!row) throw refuse(PROBLEMS.NOT_FOUND, 'No such store.')

  const { rows: links } = await query(
    app.pg, 'SELECT asset_id FROM store_media WHERE store_id = $1 ORDER BY position', [row.id], { signal },
  )
  const wanted = links.map((l) => String(l.asset_id))
  for (const id of [row.cover_asset_id, row.logo_asset_id]) if (id) wanted.push(String(id))
  // Only `ready` derivatives come back; a file still processing is simply absent.
  const items = await loadMediaItems(app.pg, wanted)

  return {
    displayName: String(row.display_name),
    slug: String(row.slug),
    logo: row.logo_asset_id ? items.get(String(row.logo_asset_id)) ?? null : null,
    description: row.description ?? null,
    cover: row.cover_asset_id ? items.get(String(row.cover_asset_id)) ?? null : null,
    media: links.flatMap((l) => items.get(String(l.asset_id)) ?? []),
    openingHours: row.opening_hours ?? null,
  }
}
