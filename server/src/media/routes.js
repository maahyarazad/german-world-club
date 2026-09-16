import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'

import { PROBLEMS } from '@gwc/contracts/errors'
import {
  assetSchema, deliveryLookupParamSchema, assetIdParamSchema, deleteResultSchema,
  altSchema, DELIVERY_CACHE_CONTROL,
} from '@gwc/contracts/media'

import { withTransaction, query } from '../db/query.js'
import { reserve, release, SCOPE, QuotaExceededError } from '../db/counters.js'
import { validateUpload, MediaRejected, extensionAgrees } from './validate.js'
import { stripMetadata } from './strip-metadata.js'
import { deriveImage } from './derive-image.js'
import { probeVideo } from './derive-video.js'
import { checksumOf, hexOf, keyFor, extensionFor } from './storage.js'
import { enqueueVideoDerivatives } from './queue.js'
import { forbidden } from '../authz/require-permission.js'

/**
 * Media ingest and delivery (media-pipeline.md §1–§3).
 *
 * The shape of this file follows the one rule that makes the whole pipeline
 * safe: **no asset is recorded `ready` unless its derivatives exist** (FR-063).
 * Everything else — the ordering of validation, the fail-closed breaker, the
 * quota reservation inside the transaction — exists to keep that true under
 * failure. A `ready` asset with no derivatives is worse than a refused upload,
 * because every page that references it then has nothing to serve and no error
 * to explain why.
 */

const MIME_FOR_FORMAT = Object.freeze({
  webp: 'image/webp', png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webm: 'video/webm',
})

/**
 * Variants are always read in the same order.
 *
 * Without an ORDER BY, PostgreSQL returns rows in physical order, which differs
 * between a freshly-inserted asset and one read back on the dedupe path. That
 * would make the `variants` array in an API response non-deterministic for the
 * same asset — which breaks a client building a stable `srcset`, and makes any
 * cached or compared response spuriously different. Width ascending, then
 * format, so the primary encoding leads at each size.
 */
const VARIANTS_IN_ORDER =
  'SELECT * FROM asset_variants WHERE asset_id = $1 ORDER BY width, format'

/** The same ordering, for rows built in memory rather than read back. */
const sortVariants = (rows) =>
  [...rows].sort((a, b) => a.width - b.width || String(a.format).localeCompare(String(b.format)))

/** The public URL for one variant. Content-addressed, hence immutable. */
export const urlForVariant = (checksumHex, variant, format) =>
  `/media/${checksumHex}/${variant}.${extensionFor(format)}`

const toResponse = (asset, variants) => ({
  id: asset.id,
  kind: asset.kind,
  mime: asset.mime,
  width: asset.width,
  height: asset.height,
  durationMs: asset.duration_ms ?? null,
  alt: asset.alt,
  state: asset.state,
  failureReason: asset.failure_reason ?? null,
  bytes: Number(asset.bytes),
  createdAt: new Date(asset.created_at).toISOString(),
  variants: variants.map((v) => ({
    variant: v.variant,
    format: v.format,
    width: v.width,
    height: v.height,
    bytes: Number(v.bytes),
    url: urlForVariant(hexOf(asset.checksum), v.variant, v.format),
  })),
})

export default fp(
  async function mediaRoutes(app, opts = {}) {
    const storage = opts.storage ?? app.mediaStorage
    const queue = opts.queue ?? app.jobQueue ?? null
    const maxBytes = app.env.MEDIA_MAX_BYTES
    const maxPixels = app.env.MEDIA_MAX_PIXELS
    /** Per-account ceiling on stored bytes (FR-063). */
    const storedByteQuota = opts.storedByteQuota ?? app.env.MEDIA_ACCOUNT_QUOTA_BYTES ?? 1_073_741_824

    await app.register(multipart, {
      limits: {
        // Step 1 of media-pipeline.md §4, enforced **while streaming**. The
        // point is to never buffer 25 MB in order to discover it is 25 MB.
        fileSize: maxBytes,
        files: 1,
        fields: 4,
      },
    })

    // ---- POST /media --------------------------------------------------------

    app.post(
      '/media',
      {
        config: {
          auth: { audience: 'member' },
          budget: 'media-upload',
          rateLimit: app.bucket('upload'),
        },
        onRequest: app.guard,
        schema: { response: { 201: assetSchema, 202: assetSchema } },
      },
      async (request, reply) => {
        const uploaded = await request.file().catch((err) => {
          if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
            throw new MediaRejected(PROBLEMS.MEDIA_TOO_LARGE, `The upload exceeds the ${Math.floor(maxBytes / 1048576)} MB limit.`)
          }
          throw err
        })
        if (!uploaded) {
          throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'A file is required.')
        }

        const alt = altSchema.safeParse(uploaded.fields?.alt?.value)
        if (!alt.success) {
          // §10.1: galleries need alt text, so it is required at ingest rather
          // than nullable and backfilled. Discovering it is missing at publish
          // time means going back to whoever uploaded it weeks earlier.
          throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'Alt text is required, between 1 and 300 characters.')
        }

        const buffer = await uploaded.toBuffer()
        if (uploaded.file.truncated) {
          throw new MediaRejected(PROBLEMS.MEDIA_TOO_LARGE, `The upload exceeds the ${Math.floor(maxBytes / 1048576)} MB limit.`)
        }

        // Steps 2-4: magic bytes, allowlist, pre-decode dimension bound.
        const validated = await validateUpload(buffer, { maxBytes, maxPixels })

        if (uploaded.filename && !extensionAgrees(uploaded.filename, validated.mime)) {
          // Not a refusal — the bytes already decided. Logged so a batch of
          // mislabelled uploads from one client is noticeable (SC-021).
          request.log.info(
            { filename: uploaded.filename, detected: validated.mime },
            'upload extension disagrees with its contents',
          )
        }

        const principal = request.principal
        return validated.kind === 'image'
          ? ingestImage(request, reply, { buffer, validated, alt: alt.data, principal })
          : ingestVideo(request, reply, { buffer, validated, alt: alt.data, principal })
      },
    )

    /**
     * Images are synchronous: a 2 MB photograph through `sharp` is roughly
     * 200–600 ms for the whole variant set, which fits the 8 s budget. So the
     * upload response already carries every variant URL and the client never
     * has to poll (media-pipeline.md §5).
     */
    async function ingestImage(request, reply, { buffer, validated, alt, principal }) {
      /**
       * Derivation runs under the media breaker, fail-closed (FR-063).
       *
       * Everything that could fail happens BEFORE the transaction opens. The
       * database work is then short and cannot leave a half-written asset if
       * `sharp` dies on the next file.
       */
      const derived = await app.breakers.mediaImage.run(async () => {
        const stripped = await stripMetadata(buffer, { limitInputPixels: maxPixels })
        const result = await deriveImage(stripped.buffer, { limitInputPixels: maxPixels })
        return { stripped, ...result }
      })

      const checksum = checksumOf(derived.stripped.buffer)
      const originalKey = keyFor(checksum, { variant: 'original', format: validated.mime })

      // Storage first, database second. A stored object with no row is
      // reclaimable garbage; a row pointing at bytes that were never written is
      // a broken page on a partner's profile.
      await storage.put(originalKey, derived.stripped.buffer, { contentType: validated.mime })
      for (const variant of derived.variants) {
        await storage.put(
          keyFor(checksum, { variant: variant.variant, format: variant.format }),
          variant.buffer,
          { contentType: MIME_FOR_FORMAT[variant.format] },
        )
      }

      const totalBytes =
        derived.stripped.buffer.length + derived.variants.reduce((sum, v) => sum + v.bytes, 0)

      const { asset, variants } = await withTransaction(app.pg, async (client) => {
        // Content-addressed dedupe: identical bytes are one stored copy. The
        // existing row is returned rather than a second created, so the caller
        // gets working URLs and the quota is not charged twice.
        const { rows: existing } = await client.query(
          'SELECT * FROM assets WHERE checksum = $1',
          [checksum],
        )
        if (existing.length > 0) {
          const { rows: existingVariants } = await client.query(
            VARIANTS_IN_ORDER,
            [existing[0].id],
          )
          return { asset: existing[0], variants: existingVariants, deduped: true }
        }

        // The quota reservation takes its row lock inside THIS transaction, so
        // two concurrent uploads cannot both read "just under the ceiling" and
        // both proceed (FR-043).
        await reserve(client, SCOPE.STORED_BYTES, principal.id, totalBytes, {
          defaultLimit: storedByteQuota,
        })

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

      return reply.code(201).send(toResponse(asset, variants))
    }

    /**
     * Video is asynchronous: a WebM transcode takes minutes and is CPU-bound.
     * It fits no request budget in resilience.md §1, and holding the request
     * open would violate FR-032.
     *
     * Dimensions are still probed synchronously (FR-055), because §10.9's
     * layout-shift requirement needs width and height at first render and
     * cannot wait for the transcode.
     */
    async function ingestVideo(request, reply, { buffer, validated, alt, principal }) {
      const probed = await probeVideo(buffer)
      if (!probed.width || !probed.height) {
        throw new MediaRejected(PROBLEMS.VALIDATION_FAILED, 'The video’s dimensions could not be read.')
      }

      const checksum = checksumOf(buffer)
      const originalKey = keyFor(checksum, { variant: 'original', format: validated.mime })
      await storage.put(originalKey, buffer, { contentType: validated.mime })

      const asset = await withTransaction(app.pg, async (client) => {
        const { rows: existing } = await client.query('SELECT * FROM assets WHERE checksum = $1', [checksum])
        if (existing.length > 0) return existing[0]

        await reserve(client, SCOPE.STORED_BYTES, principal.id, buffer.length, {
          defaultLimit: storedByteQuota,
        })

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
        await enqueueVideoDerivatives(queue, {
          assetId: asset.id, checksum: hexOf(checksum), mime: validated.mime,
        })
      }

      const { rows: variants } = await query(
        app.pg, VARIANTS_IN_ORDER, [asset.id],
      )
      return reply.code(202).send(toResponse(asset, variants))
    }

    // ---- GET /media/:id -----------------------------------------------------

    app.get(
      '/media/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { params: assetIdParamSchema, response: { 200: assetSchema } },
      },
      async (request, reply) => {
        const { rows } = await query(app.pg, 'SELECT * FROM assets WHERE id = $1', [request.params.id], {
          signal: request.deadlineSignal,
        })
        if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')

        const { rows: variants } = await query(
          app.pg, VARIANTS_IN_ORDER, [rows[0].id],
          { signal: request.deadlineSignal },
        )
        // `state` and `failure_reason` are both included so a client polling a
        // processing video can tell "still working" from "gave up, here is why".
        return reply.send(toResponse(rows[0], variants))
      },
    )

    // ---- DELETE /media/:id --------------------------------------------------

    app.delete(
      '/media/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { params: assetIdParamSchema, response: { 200: deleteResultSchema } },
      },
      async (request, reply) => {
        const principal = request.principal

        const outcome = await withTransaction(app.pg, async (client) => {
          const { rows } = await client.query('SELECT * FROM assets WHERE id = $1 FOR UPDATE', [request.params.id])
          if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')
          const asset = rows[0]

          // Ownership, or the module flag for staff.
          const owns = asset.uploaded_by === principal.id && asset.uploader_kind === principal.kind
          const staffMayDelete = principal.kind === 'admin' && request.permissions?.isSuperadmin
          if (!owns && !staffMayDelete) {
            throw forbidden(PROBLEMS.INSUFFICIENT_PERMISSION, 'This asset belongs to someone else.')
          }

          const { rows: variants } = await client.query(
            'SELECT storage_key FROM asset_variants WHERE asset_id = $1', [asset.id],
          )

          await client.query('DELETE FROM assets WHERE id = $1', [asset.id])

          // Content-addressed storage means bytes may be shared. Removing them
          // while another asset points at the same checksum would break that
          // asset's URLs — which is exactly the failure dedupe is supposed to be
          // invisible against.
          const { rows: sharing } = await client.query(
            'SELECT 1 FROM assets WHERE checksum = $1 LIMIT 1', [asset.checksum],
          )
          const bytesRemoved = sharing.length === 0

          if (asset.uploaded_by) {
            await release(client, SCOPE.STORED_BYTES, asset.uploaded_by, Number(asset.bytes))
          }

          return { asset, variants, bytesRemoved }
        })

        if (outcome.bytesRemoved) {
          // Outside the transaction: an object-store failure must not roll back
          // a committed delete, and an orphaned object is reclaimable garbage.
          await Promise.allSettled([
            storage.remove(outcome.asset.storage_key),
            ...outcome.variants.map((v) => storage.remove(v.storage_key)),
          ])
        }

        await app.audit({
          action: 'media_deleted', outcome: 'allowed', requestId: request.id,
          actorId: principal.id, actorKind: principal.kind,
          targetType: 'asset', targetId: outcome.asset.id,
          detail: { bytesRemoved: outcome.bytesRemoved },
        })

        return reply.send({ id: outcome.asset.id, deleted: true, bytesRemoved: outcome.bytesRemoved })
      },
    )

    // ---- GET /media/:checksum/:variant.:ext ---------------------------------

    app.get(
      '/media/:checksum/:variant.:ext',
      {
        // Public: derivatives are referenced by public pages. The surface table
        // marks /media public-but-not-indexed, so a crawler may fetch the images
        // a partner page references without the images themselves being indexed
        // as pages (seo/surfaces.js).
        config: { auth: { audience: 'public' }, budget: 'public-page', rateLimit: app.bucket('public-read') },
        schema: { params: deliveryLookupParamSchema },
      },
      async (request, reply) => {
        const { checksum, variant, ext } = request.params
        const format = ext === 'jpg' ? 'jpeg' : ext

        const { rows } = await query(
          app.pg,
          `SELECT v.storage_key, v.format, v.bytes, a.mime
             FROM asset_variants v JOIN assets a ON a.id = v.asset_id
            WHERE encode(a.checksum, 'hex') = $1 AND v.variant = $2 AND v.format = $3`,
          [checksum, variant, format],
          { signal: request.deadlineSignal },
        )
        if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such variant.')

        const body = await storage.get(rows[0].storage_key)

        return reply
          // Safe precisely because the path is content-addressed: different
          // bytes produce a different checksum, so a URL's content can never
          // change (FR-062). Immutability here is a fact, not a promise.
          .header('cache-control', DELIVERY_CACHE_CONTROL)
          .header('content-type', MIME_FOR_FORMAT[rows[0].format] ?? 'application/octet-stream')
          .header('content-disposition', `inline; filename="${variant}.${ext}"`)
          // With an explicit Content-Type, this is what stops a polyglot file
          // being re-interpreted as something executable on the club's origin.
          .header('x-content-type-options', 'nosniff')
          .send(body)
      },
    )

    /** Translate the pipeline's own errors into the shared envelope. */
    app.addHook('onError', async (request, reply, error) => {
      if (error instanceof QuotaExceededError) {
        error.problem = PROBLEMS.MEDIA_QUOTA_EXCEEDED
        error.statusCode = PROBLEMS.MEDIA_QUOTA_EXCEEDED.status
        error.safeDetail = `Stored-media quota reached: ${error.used} of ${error.limit} bytes in use.`
      }
    })
  },
  { name: 'media-routes', dependencies: ['auth', 'rate-limit', 'breakers'] },
)

export { MediaRejected }
