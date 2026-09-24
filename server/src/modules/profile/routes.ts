import fp from 'fastify-plugin'
import { z } from 'zod'
import {
  memberProfileSchema, updateProfileRequestSchema, publicMemberProfileSchema, organisationProfileSchema,
  setHandleRequestSchema, handleAvailabilitySchema, setAvatarRequestSchema, setLinksRequestSchema,
  organisationPublicProfileSchema, updateOrganisationProfileRequestSchema,
} from '@gwc/contracts/profile'
import { createProfileController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Profiles (features 009 and 010): schema, posture and wiring.
 *
 * One route per audience for the organisation profile, because a route's
 * audience is part of its posture and cannot be two things at once — the same
 * reason staff sign out through a route of their own. All of `/profile` is
 * declared gated and never indexed in seo/surfaces.ts: there is no public
 * profile page (spec A-3).
 */
export default fp(
  async function profileRoutes(app: GwcApp) {
    const controller = createProfileController(app)
    const read = { auth: { audience: 'member' }, budget: 'member-read', rateLimit: app.bucket('member-api') } as const
    const write = { auth: { audience: 'member' }, budget: 'member-write', rateLimit: app.bucket('write-heavy') } as const
    // A handle segment is bounded before it reaches a query; the pattern
    // itself is the application's call, so a malformed one is a clean 404.
    const handleParams = z.object({ handle: z.string().min(1).max(31) })

    app.get('/profile/me', { config: read, onRequest: app.guard, schema: { response: { 200: memberProfileSchema } } }, controller.me)

    app.patch(
      '/profile/me',
      { config: write, onRequest: app.guard, schema: { body: updateProfileRequestSchema, response: { 200: memberProfileSchema } } },
      controller.update,
    )

    app.put(
      '/profile/me/handle',
      { config: write, onRequest: app.guard, schema: { body: setHandleRequestSchema, response: { 200: memberProfileSchema } } },
      controller.setHandle,
    )

    app.get(
      '/profile/handles/:handle/available',
      { config: read, onRequest: app.guard, schema: { params: handleParams, response: { 200: handleAvailabilitySchema } } },
      controller.handleAvailable,
    )

    app.put(
      '/profile/me/avatar',
      { config: write, onRequest: app.guard, schema: { body: setAvatarRequestSchema, response: { 200: memberProfileSchema } } },
      controller.setAvatar,
    )

    app.put(
      '/profile/me/links',
      { config: write, onRequest: app.guard, schema: { body: setLinksRequestSchema, response: { 200: memberProfileSchema } } },
      controller.setLinks,
    )

    app.get(
      '/profile/members/:id',
      {
        config: read,
        onRequest: app.guard,
        schema: { params: z.object({ id: z.string().uuid() }), response: { 200: publicMemberProfileSchema } },
      },
      controller.member,
    )

    app.get(
      '/profile/handles/:handle',
      { config: read, onRequest: app.guard, schema: { params: handleParams, response: { 200: publicMemberProfileSchema } } },
      controller.memberByHandle,
    )

    app.get(
      '/profile/organisations/:slug',
      {
        config: read,
        onRequest: app.guard,
        schema: { params: z.object({ slug: z.string().min(1).max(200) }), response: { 200: organisationPublicProfileSchema } },
      },
      controller.organisationPublic,
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

      // The logo itself is uploaded through POST /media/{audience}; this
      // route links it, which is where "an image from THIS organisation" is
      // checked.
      app.patch(
        `/profile/${audience}/public`,
        {
          config: { auth: { audience }, budget: 'member-write', rateLimit: app.bucket('write-heavy') },
          onRequest: app.guard,
          schema: { body: updateOrganisationProfileRequestSchema, response: { 200: organisationProfileSchema } },
        },
        controller.updateOrganisation,
      )
    }
  },
  { name: 'profile-routes', dependencies: ['auth', 'rate-limit'] },
)
