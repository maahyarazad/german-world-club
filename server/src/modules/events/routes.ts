import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  eventListSchema, eventDetailSchema, eventRegistrationSchema, registerForEventRequestSchema,
} from '@gwc/contracts/events'
import { createEventController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Member events (§4, feature 009): schema, posture and wiring.
 *
 * Under `/member/events`, not `/events`: the latter is the public, indexed
 * event-page surface (seo/surfaces.ts), and member-only JSON with prices and
 * seat counts must not share its crawl posture. The `member-api` surface row
 * declares this prefix gated and never indexed.
 */
export default fp(
  async function eventRoutes(app: GwcApp) {
    const controller = createEventController(app)
    const params = z.object({ id: z.string().uuid() })
    const read = { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') } as const

    app.get(
      '/member/events',
      {
        config: read,
        onRequest: app.guard,
        schema: {
          querystring: z.object({ when: z.enum(['upcoming', 'past']).optional(), cursor: z.string().optional() }),
          response: { 200: eventListSchema },
        },
      },
      controller.list,
    )

    app.get(
      '/member/events/:id',
      { config: read, onRequest: app.guard, schema: { params, response: { 200: eventDetailSchema } } },
      controller.detail,
    )

    app.post(
      '/member/events/:id/registration',
      {
        config: write,
        onRequest: app.guard,
        schema: { params, body: registerForEventRequestSchema, response: { 201: eventRegistrationSchema } },
      },
      controller.register,
    )

    app.delete(
      '/member/events/:id/registration',
      { config: write, onRequest: app.guard, schema: { params, response: { 204: z.null() } } },
      controller.cancel,
    )
  },
  { name: 'event-routes', dependencies: ['auth', 'rate-limit'] },
)
