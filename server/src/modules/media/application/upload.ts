import { PROBLEMS } from '@gwc/contracts/errors'
import { withTransaction, query } from '../../../db/query.ts'
import { reserve, SCOPE } from '../../../db/counters.ts'
import { MediaRejected } from '../validate.ts'
import { stripMetadata } from '../strip-metadata.ts'
import { deriveImage } from '../derive-image.ts'
import { probeVideo } from '../derive-video.ts'
import { checksumOf, hexOf, keyFor } from '../storage.ts'
import { enqueueVideoDerivatives } from '../queue.ts'
import { MIME_FOR_FORMAT, VARIANTS_IN_ORDER, sortVariants, toResponse } from './format.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'
import type { StorageDriver } from '../storage.ts'

/**
 * Media ingest (media-pipeline.md §1–§3), framework-free.
 *
 * The rule that makes the whole pipeline safe: **no asset is recorded `ready`
 * unless its derivatives exist** (FR-063). Everything else — the ordering of
 * validation, the fail-closed breaker, the quota reservation inside the
 * transaction — exists to keep that true under failure. A `ready` asset with
 * no derivatives is worse than a refused upload, because every page that
 * references it then has nothing to serve and no error to explain why.
 */

/**
 * Images are synchronous: a 2 MB photograph through `sharp` is roughly
 * 200–600 ms for the whole variant set, which fits the 8 s budget. So the
 * upload response already carries every variant URL and the client never has
 * to poll (media-pipeline.md §5).
 */
/** What both ingest paths are handed once the upload has been validated. */
export type IngestInput = {
  storage: StorageDriver
  storedByteQuota: number
  buffer: Buffer
  /** The result of magic-byte inspection: the mime the bytes actually are. */
  validated: { mime: string; format?: string; width?: number; height?: number; bytes?: number }
  alt: string
  /** Always present: the upload route is gated, so the guard runs upstream. */
  principal: { id: string; kind: string }
  maxPixels?: number
  queue?: unknown
}

export async function ingestImage(
  app: GwcApp,
  { storage, maxPixels, storedByteQuota, buffer, validated, alt, principal }: IngestInput,
) {
  /**
   * Derivation runs under the media breaker, fail-closed (FR-063).
   *
   * Everything that could fail happens BEFORE the transaction opens. The
   * database work is then short and cannot leave a half-written asset if
   * `sharp` dies on the next file.
   */
  const derived = await app.breakers.mediaImage!.run(async () => {
    const stripped = await stripMetadata(buffer, { limitInputPixels: maxPixels })
    const result = await deriveImage(stripped.buffer, { limitInputPixels: maxPixels })
    return { stripped, ...result }
  })

  const checksum = checksumOf(derived.stripped.buffer)
  const originalKey = keyFor(checksum, { variant: 'original', format: validated.mime })

  // Storage first, database second. A stored object with no row is
  // reclaimable garbage; a row pointing at bytes that were never written is a
  // broken page on a partner's profile.
  await storage.put(originalKey, derived.stripped.buffer, { contentType: validated.mime })
  for (const variant of derived.variants) {
    await storage.put(
      keyFor(checksum, { variant: variant.variant, format: variant.format }),
      variant.buffer,
      { contentType: MIME_FOR_FORMAT[variant.format] },
    )
  }

  const totalBytes =
    derived.stripped.buffer.length + derived.variants.reduce((sum: number, v) => sum + v.bytes, 0)

  const { asset, variants } = await withTransaction(app.pg, async (client: PoolClient) => {
    // Content-addressed dedupe: identical bytes are one stored copy. The
    // existing row is returned rather than a second created, so the caller
    // gets working URLs and the quota is not charged twice.
    const { rows: existing } = await client.query('SELECT * FROM assets WHERE checksum = $1', [checksum])
    if (existing.length > 0) {
      const { rows: existingVariants } = await client.query(VARIANTS_IN_ORDER, [existing[0].id])
      return { asset: existing[0], variants: existingVariants, deduped: true }
    }

    // The quota reservation takes its row lock inside THIS transaction, so
    // two concurrent uploads cannot both read "just under the ceiling" and
    // both proceed (FR-043).
    await reserve(client, SCOPE.STORED_BYTES, principal.id, totalBytes, { defaultLimit: storedByteQuota })

    const { rows: inserted } = await client.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, alt, state,
                           uploaded_by, uploader_kind, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9, $10)
       RETURNING *`,
      [
        'image', validated.mime, checksum, totalBytes,
        derived.source.width, derived.source.height, alt,
        principal.id, principal.kind, originalKey,
      ],
    )

    const rows = []
    for (const variant of derived.variants) {
      const { rows: v } = await client.query(
        `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (asset_id, variant, format) DO UPDATE SET bytes = EXCLUDED.bytes
         RETURNING *`,
        [
          inserted[0].id, variant.variant, variant.format, variant.width, variant.height,
          variant.bytes, keyFor(checksum, { variant: variant.variant, format: variant.format }),
        ],
      )
      rows.push(v[0])
    }

    // Sorted to match VARIANTS_IN_ORDER, so the 201 from a first upload and
    // the 201 from the dedupe path describe the same asset identically.
    return { asset: inserted[0], variants: sortVariants(rows) }
  })

  return { status: 201, body: toResponse(asset, variants) }
}

/**
 * Video is asynchronous: a WebM transcode takes minutes and is CPU-bound. It
 * fits no request budget in resilience.md §1, and holding the request open
 * would violate FR-032.
 *
 * Dimensions are still probed synchronously (FR-055), because §10.9's
 * layout-shift requirement needs width and height at first render and cannot
 * wait for the transcode.
 */
export async function ingestVideo(
  app: GwcApp,
  { storage, queue, storedByteQuota, buffer, validated, alt, principal }: IngestInput,
) {
  const probed = await probeVideo(buffer)
  if (!probed.width || !probed.height) {
    throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'The video’s dimensions could not be read.')
  }

  const checksum = checksumOf(buffer)
  const originalKey = keyFor(checksum, { variant: 'original', format: validated.mime })
  await storage.put(originalKey, buffer, { contentType: validated.mime })

  const asset = await withTransaction(app.pg, async (client: PoolClient) => {
    const { rows: existing } = await client.query('SELECT * FROM assets WHERE checksum = $1', [checksum])
    if (existing.length > 0) return existing[0]

    await reserve(client, SCOPE.STORED_BYTES, principal.id, buffer.length, { defaultLimit: storedByteQuota })

    const { rows } = await client.query(
      `INSERT INTO assets (kind, mime, checksum, bytes, width, height, duration_ms, alt,
                           state, uploaded_by, uploader_kind, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing', $9, $10, $11)
       RETURNING *`,
      [
        'video', validated.mime, checksum, buffer.length,
        probed.width, probed.height, probed.durationMs, alt,
        principal.id, principal.kind, originalKey,
      ],
    )
    return rows[0]
  })

  if (queue) {
    await enqueueVideoDerivatives(queue, { assetId: asset.id, checksum: hexOf(checksum), mime: validated.mime })
  }

  const { rows: variants } = await query(app.pg, VARIANTS_IN_ORDER, [asset.id])
  return { status: 202, body: toResponse(asset, variants) }
}
