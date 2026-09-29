import { loadProfilingStatus } from './application/status.ts'
import { submitProfiling } from './application/submit.ts'
import { completeProfiling } from './application/complete.ts'
import { listGwcCities } from './application/gwc-cities.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { ProfilingPatchRequest } from '@gwc/contracts/profiling'

/**
 * Request and reply shaping for Onboarding Phase 2 profiling (feature 013).
 * Every rule lives in `application/`.
 */
export function createProfilingController(app: GwcApp) {
  return {
    status: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadProfilingStatus(app, {
        memberId: String(request.principal!.id),
        signal: request.deadlineSignal,
      })),

    gwcCities: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listGwcCities(app, { signal: request.deadlineSignal })),

    submit: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as ProfilingPatchRequest
      const result = await submitProfiling(app, {
        memberId: String(request.principal!.id),
        body,
        signal: request.deadlineSignal,
      })
      return reply.send(result)
    },

    complete: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await completeProfiling(app, {
        memberId: String(request.principal!.id),
        signal: request.deadlineSignal,
      })),
  }
}
