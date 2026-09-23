import { listApplications, decide } from './application/review.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { ApplicationState, DenyApplicationRequest } from '@gwc/contracts/onboarding'

/** Request and reply shaping for application review. The rules live in `application/review.ts`. */
export function createOnboardingStaffController(app: GwcApp) {
  return {
    list: async (request: GwcRequest, reply: GwcReply) => {
      const { state } = request.query as { state?: ApplicationState }
      const items = await listApplications(app, { state, signal: request.deadlineSignal })
      return reply.send({ items })
    },

    approve: async (request: GwcRequest, reply: GwcReply) => {
      const { memberId } = request.params as { memberId: string }
      return reply.send(await decide(app, {
        memberId, adminId: String(request.principal!.id), decision: { state: 'approved' },
        requestId: request.id, signal: request.deadlineSignal,
      }))
    },

    deny: async (request: GwcRequest, reply: GwcReply) => {
      const { memberId } = request.params as { memberId: string }
      const { reason } = request.body as DenyApplicationRequest
      return reply.send(await decide(app, {
        memberId, adminId: String(request.principal!.id), decision: { state: 'denied', reason },
        requestId: request.id, signal: request.deadlineSignal,
      }))
    },
  }
}
