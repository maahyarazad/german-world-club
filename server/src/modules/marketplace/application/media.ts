import { PROBLEMS } from '@gwc/contracts/errors'
import { query, withTransaction } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { urlForVariant } from '../../media/application/format.ts'
import { hexOf } from '../../media/storage.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'

/**
 * A listing's media (FR-013, FR-014, FR-039, FR-040).
 *
 * The pipeline is `modules/media`, reused unchanged: it already inspects magic
 * bytes, strips metadata, derives at declared breakpoints and never serves the
 * original. This module only *links* assets to a listing.
 *
 * A listing may carry one photo, several photos, or a video. `position` is
 * explicit because the first item represents the listing in the index — and
 * for a video that means its `poster` variant, so a browse page never
 * autoplays and never waits on a transcode.
 */

/** Bound from data-model.md §5; also a CHECK constraint on the table. */
export const MAX_MEDIA_PER_LISTING = 20

export async function attachMedia(
  app: GwcApp,
  { listingId, ownerId, assetId, signal }:
    { listingId: string; ownerId: string; assetId: string; signal?: AbortSignal },
) {
  return withTransaction(app.pg, async (client: PoolClient) => {
    // Ownership against the loaded row, inside the transaction — a route-level
    // declaration cannot express "yours" (Principle II).
    const { rows: owned } = await client.query(
      'SELECT id FROM marketplace_listings WHERE id = $1::uuid AND owner_id = $2::uuid FOR UPDATE',
      [listingId, ownerId],
    )
    // 404, not 403: a 403 would confirm the listing exists to someone guessing
    // uuids, which is the `guardOrganisationScope` precedent.
    if (owned.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such listing.')

    // The asset must be one THIS member uploaded, and must be ready. Without
    // the first check a member could attach a stranger's asset id to their own
    // listing and republish someone else's photo under their name; without the
    // second, the index would render a listing whose derivatives do not exist
    // yet. `processing` is a retry, not a refusal, which is why it is a
    // distinct message.
    const { rows: asset } = await client.query(
      'SELECT id, state FROM assets WHERE id = $1::uuid AND uploaded_by = $2::uuid',
      [assetId, ownerId],
    )
    if (asset.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')
    if (asset[0]!.state !== 'ready') {
      throw forbidden(PROBLEMS.VALIDATION_FAILED,
        `That upload is still ${asset[0]!.state}; attach it once it is ready.`)
    }

    // The primary key is (listing_id, position), not (listing_id, asset_id),
    // so nothing in the schema stops the same photo appearing twice in one
    // gallery. Refused here rather than constrained there because position has
    // to stay the key — it is what orders the gallery.
    const { rows: already } = await client.query(
      'SELECT 1 FROM marketplace_listing_media WHERE listing_id = $1::uuid AND asset_id = $2::uuid',
      [listingId, assetId],
    )
    if (already.length > 0) {
      throw forbidden(PROBLEMS.VALIDATION_FAILED, 'That item is already on this listing.')
    }

    const { rows: existing } = await client.query(
      'SELECT coalesce(max(position), -1) AS last FROM marketplace_listing_media WHERE listing_id = $1::uuid',
      [listingId],
    )
    const next = Number(existing[0]!.last) + 1
    if (next >= MAX_MEDIA_PER_LISTING) {
      throw forbidden(PROBLEMS.VALIDATION_FAILED,
        `A listing may carry at most ${MAX_MEDIA_PER_LISTING} media items.`)
    }

    await client.query(
      `INSERT INTO marketplace_listing_media (listing_id, asset_id, position)
       VALUES ($1::uuid, $2::uuid, $3)`,
      [listingId, assetId, next],
    )
    return { listingId, assetId, position: next }
  }, { signal })
}

export async function detachMedia(
  app: GwcApp,
  { listingId, ownerId, assetId, signal }:
    { listingId: string; ownerId: string; assetId: string; signal?: AbortSignal },
) {
  const { rows } = await query(
    app.pg,
    `DELETE FROM marketplace_listing_media
      WHERE listing_id = $1::uuid AND asset_id = $2::uuid
        AND listing_id IN (SELECT id FROM marketplace_listings WHERE owner_id = $3::uuid)
      RETURNING asset_id`,
    [listingId, assetId, ownerId],
    { signal },
  )
  if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such media on that listing.')

  // The link row is gone; the BYTES are not. Another listing may share the
  // checksum, and media/routes is the only place that decides whether bytes
  // go (research.md R6). The FK is ON DELETE RESTRICT for exactly this.
  return { assetId, deleted: true }
}

/**
 * The media for a set of listings, as derivative URLs.
 *
 * Never the original — `verify:seo` and the media suites both assert that
 * platform-wide, and this module inherits it by using the same variants.
 */
export async function mediaForListings(
  app: GwcApp,
  listingIds: readonly string[],
  { signal }: { signal?: AbortSignal } = {},
) {
  if (listingIds.length === 0) return new Map<string, MediaItem[]>()

  const { rows } = await query(
    app.pg,
    `SELECT lm.listing_id, lm.asset_id, lm.position,
            a.kind, a.checksum, a.alt, a.width, a.height, a.duration_ms,
            v.variant, v.format, v.width AS variant_width
       FROM marketplace_listing_media lm
       JOIN assets a ON a.id = lm.asset_id AND a.state = 'ready'
       LEFT JOIN asset_variants v ON v.asset_id = a.id
      WHERE lm.listing_id = ANY($1::uuid[])
      ORDER BY lm.listing_id, lm.position, v.width NULLS LAST, v.format`,
    [listingIds],
    { signal },
  )

  const byListing = new Map<string, Map<number, MediaItem>>()
  for (const row of rows) {
    const listing = String(row.listing_id)
    const slot = byListing.get(listing) ?? new Map<number, MediaItem>()
    const position = Number(row.position)
    const item: MediaItem = slot.get(position) ?? {
      assetId: String(row.asset_id),
      kind: String(row.kind),
      position,
      alt: String(row.alt),
      width: Number(row.width),
      height: Number(row.height),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      variants: [],
      posterUrl: null,
    }

    if (row.variant) {
      const url = urlForVariant(hexOf(row.checksum), row.variant, row.format)
      // FR-040: the index renders a video by its POSTER frame. Kept apart from
      // `variants` so a client cannot pick it by accident, and so a browse page
      // neither autoplays nor waits on a transcode to paint.
      if (row.variant === 'poster') item.posterUrl = url
      else item.variants.push({
        variant: String(row.variant),
        format: String(row.format),
        width: Number(row.variant_width),
        url,
      })
    }

    slot.set(position, item)
    byListing.set(listing, slot)
  }

  return new Map(
    [...byListing].map(([listing, slot]) => [
      listing, [...slot.values()].sort((a, b) => a.position - b.position),
    ]),
  )
}

export type MediaItem = {
  assetId: string
  kind: string
  position: number
  alt: string
  width: number
  height: number
  durationMs: number | null
  variants: { variant: string; format: string; width: number; url: string }[]
  /** Non-null only for a video. The index renders this, never the video. */
  posterUrl: string | null
}
