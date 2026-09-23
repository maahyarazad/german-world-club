import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  memberProfileSchema, updateProfileRequestSchema, publicMemberProfileSchema, organisationProfileSchema,
} from '@gwc/contracts/profile'
import { createProfileController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Profiles (feature 009): schema, posture and wiring.
 *
 * One route per audience for the organisation profile, because a route's
 * audience is part of its posture and cannot be two things at once — the same
 * reason staff sign out through a route of their own.
 */
export default fp(
  async function profileRoutes(app: GwcApp) {
    const controller = createProfileController(app)

    app.get(
      '/profile/me',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { response: { 200: memberProfileSchema } },
      },
      controller.me,
    )

    app.patch(
      '/profile/me',
      {
        config: { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
        onRequest: app.guard,
        schema: { body: updateProfileRequestSchema, response: { 200: memberProfileSchema } },
      },
      controller.update,
    )

    app.get(
      '/profile/members/:id',
      {
        config: { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') },
        onRequest: app.guard,
        schema: { params: z.object({ id: z.string().uuid() }), response: { 200: publicMemberProfileSchema } },
      },
      controller.member,
    )

    for (const audience of ['merchant', 'partner'] as const) {
      app.get(
        `/profile/${audience}`,
        {
          config: { auth: { audience }, budget: 'member-read', rateLimit: app.bucket('member-api') },
          onRequest: app.guard,
          schema: { response: { 200: organisationProfileSchema } },
        },
        controller.organisation,
      )
    }
  },
  { name: 'profile-routes', dependencies: ['auth', 'rate-limit'] },
)
