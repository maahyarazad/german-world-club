import fp from 'fastify-plugin'
import { z } from 'zod'
import { createRagController } from './controller.ts'
import { createRagPool } from './application/ask.ts'
import type { GwcApp } from '../../app.ts'

/**
 * The public question-answering endpoint (pgai + Anthropic over
 * `docs_embeddings`).
 *
 * **`audience: 'public'` is deliberate and is the whole security posture of
 * this route.** Principle II makes that an affirmative act that shows up in a
 * diff, which is exactly what it should be here: every other unauthenticated
 * surface on this server returns a cached page, whereas this one spends money
 * per request. The compensating controls are therefore all stated rather than
 * implied —
 *
 *  - an IP-dimensioned bucket that does NOT fail open, unlike `public-read`:
 *    skipping the limiter when Redis is unreachable is the right trade for a
 *    crawler fetching a page and the wrong one for a paid model call,
 *  - a bounded prompt, refused by the schema before any connection is taken,
 *  - the instruction fixed in `application/ask.ts`, so a caller supplies the
 *    question and never the prompt.
 *
 * `modules/seo/surfaces.ts` declares `/rag` public-but-not-indexed, so
 * `02-security-headers.ts` stamps `X-Robots-Tag: noindex`: an answer generated
 * per request is not a page, and indexing one would put model output in search
 * results under the club's name.
 */
export default fp(
  async function ragRoutes(app: GwcApp) {
    const pool = createRagPool(app)
    // Owned by this plugin, so it closes with the app rather than holding the
    // process open through a graceful shutdown.
    app.addHook('onClose', async () => { await pool.end() })

    const controller = createRagController(app, pool)

    app.post(
      '/rag/ask',
      {
        config: {
          auth: { audience: 'public' },
          budget: 'rag',
          rateLimit: app.bucket('rag-ask'),
        },
        schema: {
          body: z.object({
            // Bounded at both ends. The floor rejects the empty string, which
            // embeds to noise and retrieves arbitrary chunks; the ceiling is
            // what stops a long prompt being pasted in to run up a bill.
            prompt: z.string().trim().min(3).max(2000),
          }),
          response: {
            200: z.object({
              answer: z.string(),
              grounded: z.boolean(),
            }),
          },
        },
      },
      controller.ask,
    )
  },
  { name: 'rag-routes', dependencies: ['rate-limit'] },
)
