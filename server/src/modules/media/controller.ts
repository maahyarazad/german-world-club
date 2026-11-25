import { PROBLEMS } from '@gwc/contracts/errors'
import {
  altSchema, DELIVERY_CACHE_CONTROL, MERCHANT_IMAGE_MAX_BYTES, MERCHANT_VIDEO_MAX_BYTES,
} from '@gwc/contracts/media'
import { MediaRejected, extensionAgrees, validateUpload } from './validate.ts'
import { ingestImage, ingestVideo } from './application/upload.ts'
import { getAsset, deleteAsset, getVariant } from './application/deliver.ts'
import { forbidden } from '../../authz/require-permission.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * Every handler here pulls plain data out of `request` — including parsing
 * the multipart upload, which is inescapably a Fastify concern — calls an
 * `application/*` function with `app` plus that data, and shapes the result
 * onto `reply`. The actual pipeline rules (validation, storage, quota,
 * dedupe) live in `application/`.
 */
export function createMediaController(app: GwcApp, { storage, queue, maxBytes, maxPixels, storedByteQuota }) {
  return {
    upload: async (request: FastifyRequest, reply: FastifyReply) => {
      // Feature 035: a merchant's uploads are held to smaller limits than the
      // platform's 25 MB: a photo under 1 MiB and a video under 5 MiB. The
      // stream is cut at the larger of the two, so a 25 MB file is never
      // buffered to find out it was too big; the kind-specific limit is applied
      // below, once content inspection (not the declared type) has decided
      // which kind it is. Members and partners keep `maxBytes`.
      const merchant = request.principal?.kind === 'merchant'
      const streamLimit = merchant ? MERCHANT_VIDEO_MAX_BYTES : maxBytes
      const tooLarge = (limit: number) => new MediaRejected(
        PROBLEMS.MEDIA_TOO_LARGE,
        limit >= 1048576 ? `The upload must be under ${(limit / 1048576).toString()} MB.` : `The upload exceeds the limit.`,
      )

      const uploaded = await request.file(merchant ? { limits: { fileSize: streamLimit } } : undefined).catch((err) => {
        if (err.code === 'FST_REQ_FILE_TOO_LARGE') throw tooLarge(streamLimit)
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
      if (uploaded.file.truncated) throw tooLarge(streamLimit)

      // Steps 2-4: magic bytes, allowlist, pre-decode dimension bound.
      const validated = await validateUpload(buffer, { maxBytes, maxPixels })

      if (merchant) {
        // At or above the limit is refused: "under 1 MB" and "under 5 MB".
        const limit = validated.kind === 'image' ? MERCHANT_IMAGE_MAX_BYTES : MERCHANT_VIDEO_MAX_BYTES
        if (buffer.length >= limit) throw tooLarge(limit)
      }

      if (uploaded.filename && !extensionAgrees(uploaded.filename, validated.mime)) {
        // Not a refusal — the bytes already decided. Logged so a batch of
        // mislabelled uploads from one client is noticeable (SC-021).
        request.log.info(
          { filename: uploaded.filename, detected: validated.mime },
          'upload extension disagrees with its contents',
        )
      }

      const principal = request.principal
      const { status, body } = validated.kind === 'image'
        ? await ingestImage(app, { storage, maxPixels, storedByteQuota, buffer, validated, alt: alt.data, principal })
        : await ingestVideo(app, { storage, queue, storedByteQuota, buffer, validated, alt: alt.data, principal })

      return reply.code(status).send(body)
    },

    getAsset: async (request: FastifyRequest, reply: FastifyReply) => {
      const body = await getAsset(app, { id: request.params.id, signal: request.deadlineSignal })
      return reply.send(body)
    },

    /**
     * The processing state of one of the caller's own organisation's uploads
     * (feature 035). `GET /media/:id` is member-only, so without this a merchant
     * or partner client could not see an upload go from `processing` to `ready`
     * or `failed` — the server's half of showing progress. Someone else's asset
     * and an unknown id answer the same 404.
     */
    getOrganisationAsset: async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string }
      const principal = request.principal!
      const { rows } = await app.pg.query(
        `SELECT 1 FROM assets a
          WHERE a.id = $1 AND a.uploader_kind = $2::account_kind
            AND a.uploaded_by IN (SELECT u.id FROM organisation_users u WHERE u.organisation_id = $3)`,
        [id, principal.kind, principal.organisationId],
      )
      if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')
      return reply.send(await getAsset(app, { id, signal: request.deadlineSignal }))
    },

    deleteAsset: async (request: FastifyRequest, reply: FastifyReply) => {
      // A merchant deleting someone else's file must not learn that the id
      // exists (feature 035): the shared rule answers 403 for a file that
      // exists and is not yours, so for organisations it is turned into the 404
      // an unknown id gets, before the shared rule runs.
      if (request.principal?.kind === 'merchant') {
        const { rows } = await app.pg.query(
          `SELECT 1 FROM assets WHERE id = $1 AND uploaded_by = $2 AND uploader_kind = 'merchant'`,
          [request.params.id, request.principal.id],
        )
        if (rows.length === 0) throw forbidden(PROBLEMS.NOT_FOUND, 'No such asset.')
      }
      const body = await deleteAsset(app, {
        storage,
        id: request.params.id,
        principal: request.principal,
        permissions: request.permissions,
        requestId: request.id,
      })
      return reply.send(body)
    },

    getVariant: async (request: FastifyRequest, reply: FastifyReply) => {
      const { checksum, variant, ext } = request.params
      const { body, contentType } = await getVariant(app, { storage, checksum, variant, ext, signal: request.deadlineSignal })

      return reply
        // Safe precisely because the path is content-addressed: different
        // bytes produce a different checksum, so a URL's content can never
        // change (FR-062). Immutability here is a fact, not a promise.
        .header('cache-control', DELIVERY_CACHE_CONTROL)
        .header('content-type', contentType)
        .header('content-disposition', `inline; filename="${variant}.${ext}"`)
        // With an explicit Content-Type, this is what stops a polyglot file
        // being re-interpreted as something executable on the club's origin.
        .header('x-content-type-options', 'nosniff')
        .send(body)
    },
  }
}
