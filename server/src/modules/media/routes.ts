import fp from 'fastify-plugin'
import multipart from '@fastify/multipart'

import { PROBLEMS } from '@gwc/contracts/errors'
import {
  assetSchema, deliveryLookupParamSchema, assetIdParamSchema, deleteResultSchema,
} from '@gwc/contracts/media'

import { QuotaExceededError } from '../../db/counters.ts'
import { MediaRejected } from './validate.ts'
import { createMediaController } from './controller.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * Media ingest and delivery (media-pipeline.md §1–§3): schema, access
 * posture, and wiring to `controller.js` only. See `application/` for the
 * pipeline rules and `controller.js` for how a request maps to one of those
 * calls.
 */
export default fp(
  async function mediaRoutes(app: GwcApp, opts = {}) {
    const storage = opts.storage ?? app.mediaStorage
    const queue = opts.queue ?? app.jobQueue ?? null
    const maxBytes = app.env.MEDIA_MAX_BYTES
    const maxPixels = app.env.MEDIA_MAX_PIXELS
    /** Per-account ceiling on stored bytes (FR-063). */
    const storedByteQuota = opts.storedByteQuota ?? app.env.MEDIA_ACCOUNT_QUOTA_BYTES ?? 1_073_741_824

    const controller = createMediaController(app, { storage, queue, maxBytes, maxPixels, storedByteQuota })

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
      controller.upload,
    )

    // ---- GET /media/:id -----------------------------------------------------

    app.get(
      '/media/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { params: assetIdParamSchema, response: { 200: assetSchema } },
      },
      controller.getAsset,
    )

    // ---- DELETE /media/:id --------------------------------------------------

    app.delete(
      '/media/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { params: assetIdParamSchema, response: { 200: deleteResultSchema } },
      },
      controller.deleteAsset,
    )

    // ---- GET /media/:checksum/:variant.:ext ---------------------------------

    app.get(
      '/media/:checksum/:variant.:ext',
      {
        // Public: derivatives are referenced by public pages. The surface
        // table marks /media public-but-not-indexed, so a crawler may fetch
        // the images a partner page references without the images themselves
        // being indexed as pages (modules/seo/surfaces.js).
        config: {
          auth: { audience: 'public' },
          // Bytes, not a document: an image variant has no JSON shape a Zod
          // response schema could describe.
          produces: 'binary',
          budget: 'public-page',
          rateLimit: app.bucket('public-read'),
        },
        schema: { params: deliveryLookupParamSchema },
      },
      controller.getVariant,
    )

    /** Translate the pipeline's own errors into the shared envelope. */
    app.addHook('onError', async (request: FastifyRequest, reply: FastifyReply, error) => {
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
