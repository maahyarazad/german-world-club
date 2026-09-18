import { PROBLEMS } from '@gwc/contracts/errors'
import { altSchema, DELIVERY_CACHE_CONTROL } from '@gwc/contracts/media'
import { MediaRejected, extensionAgrees, validateUpload } from './validate.js'
import { ingestImage, ingestVideo } from './application/upload.js'
import { getAsset, deleteAsset, getVariant } from './application/deliver.js'

/**
 * Every handler here pulls plain data out of `request` — including parsing
 * the multipart upload, which is inescapably a Fastify concern — calls an
 * `application/*` function with `app` plus that data, and shapes the result
 * onto `reply`. The actual pipeline rules (validation, storage, quota,
 * dedupe) live in `application/`.
 */
export function createMediaController(app, { storage, queue, maxBytes, maxPixels, storedByteQuota }) {
  return {
    upload: async (request, reply) => {
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
      const { status, body } = validated.kind === 'image'
        ? await ingestImage(app, { storage, maxPixels, storedByteQuota, buffer, validated, alt: alt.data, principal })
        : await ingestVideo(app, { storage, queue, storedByteQuota, buffer, validated, alt: alt.data, principal })

      return reply.code(status).send(body)
    },

    getAsset: async (request, reply) => {
      const body = await getAsset(app, { id: request.params.id, signal: request.deadlineSignal })
      return reply.send(body)
    },

    deleteAsset: async (request, reply) => {
      const body = await deleteAsset(app, {
        storage,
        id: request.params.id,
        principal: request.principal,
        permissions: request.permissions,
        requestId: request.id,
      })
      return reply.send(body)
    },

    getVariant: async (request, reply) => {
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
