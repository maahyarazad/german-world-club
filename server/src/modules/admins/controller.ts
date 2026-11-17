import type { UpdateAdminRequest } from '@gwc/contracts/admin'
import { listAdmins } from './application/list.ts'
import { updateAdmin } from './application/update.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for administrator accounts. The rules live in `application/`. */
export function createAdminsController(app: GwcApp) {
  const actorOf = (request: GwcRequest) => ({
    adminId: String(request.permissions!.adminId),
    isSuperadmin: request.permissions!.isSuperadmin === true,
  })

  return {
    list: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listAdmins(app, { actor: actorOf(request), signal: request.deadlineSignal })),

    update: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await updateAdmin(app, {
        actor: actorOf(request),
        targetId: (request.params as { id: string }).id,
        changes: request.body as UpdateAdminRequest,
        request,
      })),
  }
}
