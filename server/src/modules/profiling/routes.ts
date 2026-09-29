import fp from 'fastify-plugin'
import { profilingStatusSchema, profilingPatchRequestSchema, gwcCitiesResponseSchema } from '@gwc/contracts/profiling'
import { createProfilingController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Onboarding Phase 2 (feature 013): schema, posture and wiring. The rules
 * live in `application/`.
 *
 * Both routes carry `profiling: true` — a member route an approved-but-not-
 * yet-profiled member may reach, the same escape hatch `onboarding: true`
 * gives an unapproved applicant (10-auth.ts, 11-rbac.ts). This module is
 * separate from `modules/onboarding/` because it has its own posture and its
 * own gate check, not a variant of Phase 1's.
 */
export default fp(
  async function profilingRoutes(app: GwcApp) {
    const controller = createProfilingController(app)
    const profiling = { audience: 'member', profiling: true } as const

    app.get(
      '/profiling/status',
      {
        config: { auth: profiling, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: profilingStatusSchema } },
      },
      controller.status,
    )

    // The dropdown data for the nearest-city step (research R4): a short,
    // reference-data list, so the client filters by the country it already
    // picked rather than the server taking a query-string filter.
    app.get(
      '/profiling/gwc-cities',
      {
        config: { auth: profiling, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: gwcCitiesResponseSchema } },
      },
      controller.gwcCities,
    )

    app.patch(
      '/profiling',
      {
        config: { auth: profiling, budget: 'member-write' },
        onRequest: app.guard,
        schema: { body: profilingPatchRequestSchema, response: { 200: profilingStatusSchema } },
      },
      controller.submit,
    )
  },
  { name: 'profiling-routes', dependencies: ['auth', 'rate-limit'] },
)
