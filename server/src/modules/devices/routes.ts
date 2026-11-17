import fp from 'fastify-plugin'
import { z } from 'zod'
import { memberDevicesResponseSchema } from '@gwc/contracts/devices'
import { createDevicesController } from './controller.ts'
import type { FastifyReply } from 'fastify'
import type { GwcApp } from '../../app.ts'

/**
 * The member's own devices (feature 026, contracts/devices-api.md).
 *
 * `/member/devices`, not `/devices`: `/member` is already declared gated and
 * never indexed in seo/surfaces.ts, so this inherits that posture instead of
 * adding a prefix to remember. Member audience only, and no `onboarding` or
 * `profiling` flag — an applicant is refused here as on every member route.
 * Responses are `private, no-store`: a device list is personal and a cached
 * copy would show a signed-out device as still signed in.
 */
export default fp(
  async function deviceRoutes(app: GwcApp) {
    const controller = createDevicesController(app)
    const read = { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('write-heavy') } as const
    const params = z.object({ id: z.string().uuid() })

    app.addHook('onSend', async (request, reply: FastifyReply, payload) => {
      if (request.url.startsWith('/member/devices')) reply.header('cache-control', 'private, no-store')
      return payload
    })

    app.get(
      '/member/devices',
      { config: read, onRequest: app.guard, schema: { response: { 200: memberDevicesResponseSchema } } },
      controller.list,
    )

    app.delete(
      '/member/devices/:id',
      { config: write, onRequest: app.guard, schema: { params, response: { 204: z.null() } } },
      controller.end,
    )
  },
  { name: 'device-routes' },
)
