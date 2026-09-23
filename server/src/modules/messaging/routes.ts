import fp from 'fastify-plugin'
import { z } from 'zod'
import { createMessagingController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Messaging endpoints (US5): schema, access posture and wiring only.
 *
 * `/messages` is **already** declared gated and never-indexed in
 * `seo/surfaces.ts` with the reason "Private correspondence", so this feature
 * continues a declaration rather than making one.
 *
 * **No `requires` flag.** Posting to the marketplace is gated on
 * `marketplace_post`; replying to someone who contacted you is not a privilege
 * a member has to be granted. Gating the reply would let a seller start a
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

    const conversationSchema = z.object({
      id: z.string(),
      subjectType: z.string(),
      subjectId: z.union([z.string(), z.null()]),
      createdAt: z.union([z.string(), z.date()]),
      lastMessageAt: z.union([z.string(), z.date()]),
      unreadCount: z.number().optional(),
      lastReadAt: z.union([z.string(), z.date(), z.null()]).optional(),
    })

    const messageSchema = z.object({
      id: z.string(),
      conversationId: z.string(),
      senderId: z.string(),
      body: z.string(),
      createdAt: z.union([z.string(), z.date()]),
    })

    // Display identity only. There is deliberately no email or phone field to
    // populate here, which is the schema-level half of FR-026.
    const participantSchema = z.object({
      memberId: z.string(),
      displayName: z.union([z.string(), z.null()]),
      status: z.string(),
      lastReadAt: z.union([z.string(), z.date(), z.null()]),
    })

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
          response: {
            200: z.object({
              items: z.array(conversationSchema),
              nextCursor: z.union([z.string(), z.null()]),
            }),
          },
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
          response: {
            200: z.object({
              conversation: conversationSchema,
              participants: z.array(participantSchema),
              messages: z.array(messageSchema),
              nextCursor: z.union([z.string(), z.null()]),
            }),
          },
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
          body: z.object({ body: z.string().trim().min(1).max(4000) }),
          response: { 201: messageSchema },
        },
      },
      controller.reply,
    )
  },
  { name: 'messaging-routes', dependencies: ['auth', 'rate-limit'] },
)
