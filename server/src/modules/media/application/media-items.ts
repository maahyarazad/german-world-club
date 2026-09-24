import { hexOf } from '../storage.ts'
import { urlForVariant } from './format.ts'
import type { MediaItem } from '@gwc/contracts/media'

/**
 * Delivered media for a set of assets, keyed by asset id (feature 010).
 *
 * The one loader threads and profiles use, so "derivatives only" is decided
 * once: the query reads `checksum` to BUILD variant URLs and never returns it,
 * never selects `storage_key`, and has no path to the original at all
 * (Principle VI, SC-002).
 *
 * Only `ready` assets are returned. A caller links an asset only once it is
 * ready, so a missing key means "not deliverable", and the caller renders
 * nothing rather than a broken image.
 *
 * `db` is anything with `query` — the pool, or a transaction's client when the
 * caller needs to read what it has just written.
 */
type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> }

export async function loadMediaItems(db: Queryable, assetIds: readonly string[]): Promise<Map<string, MediaItem>> {
  const ids = [...new Set(assetIds)]
  if (ids.length === 0) return new Map()

  const { rows } = await db.query(
    `SELECT a.id, a.kind, a.alt, a.width, a.height, a.duration_ms, a.checksum,
            v.variant, v.format, v.width AS variant_width, v.height AS variant_height
       FROM assets a
       LEFT JOIN asset_variants v ON v.asset_id = a.id
      WHERE a.id = ANY($1::uuid[]) AND a.state = 'ready'
      ORDER BY a.id, v.width NULLS LAST, v.format`,
    [ids],
  )

  const items = new Map<string, MediaItem>()
  for (const row of rows) {
    const id = String(row.id)
    const item: MediaItem = items.get(id) ?? {
      assetId: id,
      kind: row.kind,
      alt: String(row.alt),
      width: Number(row.width),
      height: Number(row.height),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      variants: [],
      posterUrl: null,
    }
    if (row.variant) {
      const url = urlForVariant(hexOf(row.checksum), row.variant, row.format)
      // The poster is how a feed renders a video — kept apart from `variants`
      // so it can never be picked up as the playable item (FR-040).
      if (row.variant === 'poster') item.posterUrl = url
      else item.variants.push({
        variant: row.variant,
        format: row.format,
        width: Number(row.variant_width),
        height: Number(row.variant_height),
        url,
      })
    }
    items.set(id, item)
  }
  return items
}
