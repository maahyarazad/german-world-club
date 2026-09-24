import fp from 'fastify-plugin'
import { z } from 'zod'
import { THREAD_REPORT_STATES, moderationReasonSchema } from '@gwc/contracts/threads'
import { mediaItemSchema } from '@gwc/contracts/media'
import { createThreadStaffController } from './staff-controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Staff moderation of Threads (§8), on the existing `threads_moderation`
 * module.
 *
 * As with the marketplace, `write` and `edit` appear nowhere in this file, on
 * purpose: moderating a post must never become editing it. `remove` takes
 * `delete` because it is final; `hide`/`restore`/`resolve` take `status`.
 */
export default fp(
  async function threadStaffRoutes(app: GwcApp) {
    const controller = createThreadStaffController(app)
    const params = z.object({ id: z.string().uuid() })
    const gate = (flag: 'read' | 'status' | 'delete') => ({
      auth: { audience: 'staff', module: 'threads_moderation', flag },
      budget: 'admin-read',
      rateLimit: app.bucket('admin-api'),
    } as const)

    const staffPostFields = {
      id: z.string(),
      authorId: z.string(),
      authorDisplayName: z.string().nullable(),
      body: z.string(),
      replyToId: z.string().nullable(),
      quoteOfId: z.string().nullable(),
      state: z.string(),
      stateReason: z.string().nullable(),
      stateChangedAt: z.string(),
      createdAt: z.string(),
      media: z.array(mediaItemSchema),
    }
    const staffPostSchema = z.object({
      ...staffPostFields,
      quoted: z.object(staffPostFields).nullable(),
    })

    app.get(
      '/admin/threads/reports',
      {
        config: gate('read'),
        onRequest: app.guard,
        schema: {
          querystring: z.object({ state: z.enum(THREAD_REPORT_STATES).optional() }),
          response: {
            200: z.object({
              items: z.array(z.object({
                id: z.string(),
                postId: z.string(),
                reporterId: z.string(),
                reason: z.string(),
                state: z.string(),
                createdAt: z.string(),
                resolvedAt: z.string().nullable(),
                resolvedBy: z.string().nullable(),
                resolutionNote: z.string().nullable(),
                postBody: z.string(),
                postState: z.string(),
              })),
            }),
          },
        },
      },
      controller.reports,
    )

    app.get(
      '/admin/threads/posts/:id',
      { config: gate('read'), onRequest: app.guard, schema: { params, response: { 200: staffPostSchema } } },
      controller.getPost,
    )

    for (const [action, flag] of [['hide', 'status'], ['restore', 'status'], ['remove', 'delete']] as const) {
      app.post(
        `/admin/threads/posts/:id/${action}`,
        {
          config: gate(flag),
          onRequest: app.guard,
          schema: { params, body: moderationReasonSchema, response: { 200: staffPostSchema } },
        },
        controller.moderate(action),
      )
    }

    app.post(
      '/admin/threads/reports/:id/resolve',
      {
        config: gate('status'),
        onRequest: app.guard,
        schema: {
          params,
          body: z.object({ outcome: z.enum(['upheld', 'dismissed']), note: z.string().trim().min(3).max(2000) }),
          response: { 200: z.object({ id: z.string(), state: z.string() }) },
        },
      },
      controller.resolve,
    )
  },
  { name: 'thread-staff-routes', dependencies: ['auth', 'rate-limit'] },
)
