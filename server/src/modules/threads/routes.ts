import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  FEED_SCOPES, feedSchema, postListSchema, threadViewSchema, threadPostSchema,
  createPostRequestSchema, reportPostRequestSchema, followStateSchema,
} from '@gwc/contracts/threads'
import { createThreadController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Threads (§7, feature 009): schema, posture and wiring.
 *
 * Members only, and `/threads` is already declared gated and never indexed in
 * seo/surfaces.ts (§12.10 names Threads explicitly). No `requires`: posting is
 * not a per-member privilege the way the marketplace's is — §7 describes
 * Threads as the member feed, not an opt-in.
 */
export default fp(
  async function threadRoutes(app: GwcApp) {
    const controller = createThreadController(app)
    const params = z.object({ id: z.string().uuid() })
    const cursor = z.object({ cursor: z.string().optional() })
    const read = { auth: { audience: 'member' }, budget: 'threads', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'member' }, budget: 'threads', rateLimit: app.bucket('write-heavy') } as const

    app.get(
      '/threads/feed',
      {
        config: read,
        onRequest: app.guard,
        schema: {
          querystring: z.object({ scope: z.enum(FEED_SCOPES).optional(), cursor: z.string().optional() }),
          response: { 200: feedSchema },
        },
      },
      controller.feed,
    )

    app.get(
      '/threads/members/:id/posts',
      { config: read, onRequest: app.guard, schema: { params, querystring: cursor, response: { 200: postListSchema } } },
      controller.memberPosts,
    )

    app.get(
      '/threads/posts/:id',
      { config: read, onRequest: app.guard, schema: { params, querystring: cursor, response: { 200: threadViewSchema } } },
      controller.thread,
    )

    app.post(
      '/threads/posts',
      { config: write, onRequest: app.guard, schema: { body: createPostRequestSchema, response: { 201: threadPostSchema } } },
      controller.create,
    )

    app.delete(
      '/threads/posts/:id',
      { config: write, onRequest: app.guard, schema: { params, response: { 204: z.null() } } },
      controller.remove,
    )

    // PUT/DELETE rather than POST toggles: each states the end it wants, so a
    // retried request cannot flip a like back off.
    for (const [path, on, off] of [
      ['like', controller.like, controller.unlike],
      ['repost', controller.repost, controller.unrepost],
    ] as const) {
      const options = { config: write, onRequest: app.guard, schema: { params, response: { 200: threadPostSchema } } }
      app.put(`/threads/posts/:id/${path}`, options, on)
      app.delete(`/threads/posts/:id/${path}`, options, off)
    }

    app.post(
      '/threads/posts/:id/report',
      {
        config: write,
        onRequest: app.guard,
        schema: { params, body: reportPostRequestSchema, response: { 202: z.object({ reported: z.literal(true) }) } },
      },
      controller.report,
    )

    const followOptions = { config: write, onRequest: app.guard, schema: { params, response: { 200: followStateSchema } } }
    app.put('/threads/follows/:id', followOptions, controller.follow)
    app.delete('/threads/follows/:id', followOptions, controller.unfollow)
  },
  { name: 'thread-routes', dependencies: ['auth', 'rate-limit'] },
)
