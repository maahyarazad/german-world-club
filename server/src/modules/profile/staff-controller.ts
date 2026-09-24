import { findMemberByHandle, grantDesignation, listDesignations, revokeDesignation } from './application/designations.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for staff designation management. Rules: `application/designations.ts`. */
export function createProfileStaffController(app: GwcApp) {
  const idOf = (request: GwcRequest) => (request.params as { id: string }).id
  const reasonOf = (request: GwcRequest) => (request.body as { reason: string }).reason

  return {
    byHandle: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await findMemberByHandle(app, { handle: (request.params as { handle: string }).handle, signal: request.deadlineSignal })),

    history: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listDesignations(app, { memberId: idOf(request), signal: request.deadlineSignal })),

    grant: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await grantDesignation(app, {
        memberId: idOf(request), adminId: String(request.principal!.id), designation: 'influencer',
        reason: reasonOf(request), requestId: request.id, signal: request.deadlineSignal,
      })),

    revoke: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await revokeDesignation(app, {
        memberId: idOf(request), adminId: String(request.principal!.id), designation: 'influencer',
        reason: reasonOf(request), requestId: request.id, signal: request.deadlineSignal,
      })),
  }
}
