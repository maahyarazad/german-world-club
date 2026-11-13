import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  messageSchema, inboxPageSchema, conversationViewSchema, sendMessageRequestSchema,
} from '@gwc/contracts/messaging'
import { createMessagingController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Messaging endpoints (US5): schema, access posture and wiring only.
 *
 * `/messages` is **already** declared gated and never-indexed in
 * `seo/surfaces.ts` with the reason "Private correspondence", so this feature
 * continues a declaration rather than making one.
 *
 * **No `requires` flag.** Replying to someone who contacted you is not a
 * privilege a member has to be granted (and since feature 021 posting to the
 * marketplace needs none either). Gating the reply would let a seller start a
 * conversation the buyer could not answer.
 *
 * **Message volume is rate-limited to 429, never 422.** A transport limit means
 * "wait and it works"; the marketplace's listing cap means "retrying changes
 * nothing until state does", which is why that one is 422. The two live in the
 * same feature and flattening them together is the easy mistake —
 * `tests/messaging/limits.test.ts` asserts both.
 */
export default fp(
  async function messagingRoutes(app: GwcApp) {
    const controller = createMessagingController(app)

    // Bounded in the handler, not here — see controller.boundedLimit.
    const pageQuery = z.object({
      cursor: z.string().optional(),
      limit: z.unknown().optional(),
    }).loose()

    const memberRead = {
      config: {
        auth: { audience: 'member' },
        budget: 'messaging',
        rateLimit: app.bucket('member-api'),
      },
      onRequest: app.guard,
    }

    app.get(
      '/messages/conversations',
      {
        ...memberRead,
        schema: {
          querystring: pageQuery,
          // The contract shape (feature 020, R8). Display identity only: there is
          // no email or phone field in it to populate (FR-026).
          response: { 200: inboxPageSchema },
        },
      },
      controller.inbox,
    )

    app.get(
      '/messages/conversations/:id',
      {
        ...memberRead,
        schema: {
          params: z.object({ id: z.string() }),
          querystring: pageQuery,
          response: { 200: conversationViewSchema },
        },
      },
      controller.read,
    )

    app.post(
      '/messages/conversations/:id/messages',
      {
        config: {
          auth: { audience: 'member' },
          budget: 'messaging',
          // The volume limit. 429 when exceeded, which is what the limiter
          // already answers — the point is that this is a limiter at all and
          // not a counter in `db/counters.ts`.
          rateLimit: app.bucket('messages'),
        },
        onRequest: app.guard,
        schema: {
          params: z.object({ id: z.string() }),
          // The same bounds as the CHECK constraint in 018_messaging.sql. The
          // constraint is the half that survives 007 Phase 6.
          body: sendMessageRequestSchema,
          response: { 201: messageSchema },
        },
      },
      controller.reply,
    )
  },
  { name: 'messaging-routes', dependencies: ['auth', 'rate-limit'] },
)
