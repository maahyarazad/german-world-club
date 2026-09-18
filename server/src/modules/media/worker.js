import fp from 'fastify-plugin'
import { withTransaction } from '../../db/query.js'
import { workVideoDerivatives } from './queue.js'
import { deriveVideo } from './derive-video.js'
import { keyFor } from './storage.js'
import { reserve, SCOPE } from '../../db/counters.js'

/**
 * The video derivative worker (FR-058, FR-059).
 *
 * This is the half of the asynchronous path that makes `202 processing` an
 * honest answer rather than a promise nobody keeps. The rule it exists to
 * enforce is narrow and absolute:
 *
 *   **An asset never stays `processing`.** It reaches `ready` or it reaches
 *   `failed` **with a reason**. A row stuck in `processing` is the worst of the
 *   three outcomes: a client polls forever, no page can render it, and nothing
 *   anywhere says why. The database already refuses a `failed` row with no
 *   reason (`assets_failure_reason_matches_state`); this is the code side of
 *   the same rule.
 *
 * Hence the `catch` around everything, and hence the transcode running under
 * the video breaker rather than bare: a dependency that is failing should stop
 * being hammered, and each refusal still lands as a recorded `failed` row.
 */

const MIME_FOR_FORMAT = Object.freeze({ webp: 'image/webp', webm: 'video/webm' })

/**
 * Process one job. Exported separately from the plugin so a suite can drive it
 * directly, without a queue in the way.
 */
export async function processVideoJob(app, { assetId }) {
  const { rows } = await app.pg.query('SELECT * FROM assets WHERE id = $1', [assetId])
  if (rows.length === 0) return { outcome: 'gone' }
  const asset = rows[0]

  // A retry after the work already completed must not redo it. Storage is
  // content-addressed, so the bytes would be identical anyway — but the quota
  // reservation below would be charged a second time.
  if (asset.state === 'ready') return { outcome: 'already-ready' }

  try {
    const original = await app.mediaStorage.get(asset.storage_key)

    const derived = await app.breakers.mediaVideo.run(async () =>
      deriveVideo(original, { timeoutMs: app.breakers.mediaVideo.policy.timeout }),
    )

    const outputs = [
      { variant: 'video', format: 'webm', ...derived.video },
      { variant: 'poster', format: 'webp', ...derived.poster },
    ]

    for (const output of outputs) {
      await app.mediaStorage.put(
        keyFor(asset.checksum, { variant: output.variant, format: output.format }),
        output.buffer,
        { contentType: MIME_FOR_FORMAT[output.format] },
      )
    }

    await withTransaction(app.pg, async (client) => {
      for (const output of outputs) {
        await client.query(
          `INSERT INTO asset_variants (asset_id, variant, format, width, height, bytes, storage_key)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (asset_id, variant, format) DO UPDATE
             SET bytes = EXCLUDED.bytes, width = EXCLUDED.width, height = EXCLUDED.height`,
          [
            asset.id, output.variant, output.format, output.width, output.height, output.bytes,
            keyFor(asset.checksum, { variant: output.variant, format: output.format }),
          ],
        )
      }

      const added = outputs.reduce((sum, o) => sum + o.bytes, 0)
      if (asset.uploaded_by) {
        // The derivatives are stored bytes too, and the upload only reserved
        // the original's. Charged here, inside the same transaction that
        // records them, so the counter can never disagree with the rows.
        await reserve(client, SCOPE.STORED_BYTES, asset.uploaded_by, added, {
          defaultLimit: app.env.MEDIA_ACCOUNT_QUOTA_BYTES,
        })
      }

      await client.query(
        `UPDATE assets SET state = 'ready', failure_reason = NULL, bytes = bytes + $2, updated_at = now()
          WHERE id = $1`,
        [asset.id, added],
      )
    })

    app.log.info({ assetId: asset.id }, 'video derivatives ready')
    return { outcome: 'ready' }
  } catch (err) {
    /**
     * Every failure path ends here, and every one of them writes a reason.
     * `failure_reason` is truncated rather than stored whole: it is shown to a
     * client, and an ffmpeg stderr tail can carry absolute paths.
     */
    const reason = String(err?.message ?? 'unknown error').slice(0, 300)
    await app.pg.query(
      `UPDATE assets SET state = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`,
      [assetId, reason],
    )
    app.log.error({ err, assetId }, 'video derivatives failed')
    return { outcome: 'failed', reason }
  }
}

export default fp(
  async function mediaWorker(app, opts = {}) {
    const queue = opts.queue ?? app.jobQueue
    if (!queue) return

    await workVideoDerivatives(queue, async (jobs) => {
      for (const job of [].concat(jobs)) {
        await processVideoJob(app, job.data ?? job)
      }
    })
  },
  { name: 'media-worker', dependencies: ['breakers'] },
)
