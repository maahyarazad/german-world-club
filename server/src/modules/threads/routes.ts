import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  FEED_SCOPES, PROFILE_TABS, feedSchema, postListSchema, threadViewSchema, threadPostSchema, authorListSchema,
  createPostRequestSchema, reportPostRequestSchema, followStateSchema, activityPageSchema, unreadSchema,
  markSeenRequestSchema, blockStateSchema, muteStateSchema,
} from '@gwc/contracts/threads'
import { createThreadController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Threads (§7, features 009 and 010): schema, posture and wiring.
 *
 * Members only — influencers are members — and `/threads` is declared gated
 * and never indexed in seo/surfaces.ts (§12.10 names Threads explicitly). A
 * merchant or partner token is refused by audience (010 Clarifications, A-1).
 * No `requires`: posting is not a per-member privilege the way the
 * marketplace's is — §7 describes Threads as the member feed, not an opt-in.
 */
export default fp(
  async function threadRoutes(app: GwcApp) {
    const controller = createThreadController(app)
    const params = z.object({ id: z.string().uuid() })
    const cursor = z.object({ cursor: z.string().optional() })
    const read = { auth: { audience: 'member' }, budget: 'threads', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'member' }, budget: 'threads', rateLimit: app.bucket('write-heavy') } as const
    const on = (config: typeof read | typeof write, schema: Record<string, unknown>) =>
      ({ config, onRequest: app.guard, schema })

    app.get(
      '/threads/feed',
      on(read, {
        querystring: z.object({ scope: z.enum(FEED_SCOPES).optional(), cursor: z.string().optional() }),
        response: { 200: feedSchema },
      }),
      controller.feed,
    )

    app.get(
      '/threads/members/:id/posts',
      on(read, {
        params,
        querystring: z.object({ tab: z.enum(PROFILE_TABS).optional(), cursor: z.string().optional() }),
        response: { 200: postListSchema },
      }),
      controller.memberPosts,
    )
    app.get('/threads/members/:id/followers', on(read, { params, querystring: cursor, response: { 200: authorListSchema } }), controller.followers)
    app.get('/threads/members/:id/following', on(read, { params, querystring: cursor, response: { 200: authorListSchema } }), controller.following)

    app.get('/threads/posts/:id', on(read, { params, querystring: cursor, response: { 200: threadViewSchema } }), controller.thread)
    app.get('/threads/posts/:id/quotes', on(read, { params, querystring: cursor, response: { 200: postListSchema } }), controller.quotes)
    app.get('/threads/posts/:id/likes', on(read, { params, querystring: cursor, response: { 200: authorListSchema } }), controller.likes)

    app.post(
      '/threads/posts',
      on(write, { body: createPostRequestSchema, response: { 201: threadPostSchema } }),
      controller.create,
    )

    app.delete('/threads/posts/:id', on(write, { params, response: { 204: z.null() } }), controller.remove)

    // PUT/DELETE rather than POST toggles: each states the end it wants, so a
    // retried request cannot flip a like back off.
    for (const [path, onHandler, offHandler] of [
      ['like', controller.like, controller.unlike],
      ['repost', controller.repost, controller.unrepost],
    ] as const) {
      const options = on(write, { params, response: { 200: threadPostSchema } })
      app.put(`/threads/posts/:id/${path}`, options, onHandler)
      app.delete(`/threads/posts/:id/${path}`, options, offHandler)
    }

    app.post(
      '/threads/posts/:id/report',
      on(write, { params, body: reportPostRequestSchema, response: { 202: z.object({ reported: z.literal(true) }) } }),
      controller.report,
    )

    const followOptions = on(write, { params, response: { 200: followStateSchema } })
    app.put('/threads/follows/:id', followOptions, controller.follow)
    app.delete('/threads/follows/:id', followOptions, controller.unfollow)

    // ---- Activity (US5) — computed on read; only the unread boundary is stored.
    app.get('/threads/activity', on(read, { querystring: cursor, response: { 200: activityPageSchema } }), controller.activity)
    app.get('/threads/activity/unread', on(read, { response: { 200: unreadSchema } }), controller.unread)
    app.post('/threads/activity/seen', on(write, { body: markSeenRequestSchema, response: { 204: z.null() } }), controller.seen)

    // ---- Blocks and mutes (US8)
    for (const [path, onHandler, offHandler, state] of [
      ['blocks', controller.block, controller.unblock, blockStateSchema],
      ['mutes', controller.mute, controller.unmute, muteStateSchema],
    ] as const) {
      const options = on(write, { params, response: { 200: state } })
      app.put(`/threads/${path}/:id`, options, onHandler)
      app.delete(`/threads/${path}/:id`, options, offHandler)
    }
    app.get('/threads/blocks', on(read, { response: { 200: authorListSchema } }), controller.blocks)
    app.get('/threads/mutes', on(read, { response: { 200: authorListSchema } }), controller.mutes)
  },
  { name: 'thread-routes', dependencies: ['auth', 'rate-limit'] },
)
