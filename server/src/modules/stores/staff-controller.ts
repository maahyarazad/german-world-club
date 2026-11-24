import { listStores, setStoreActive } from './application/admin.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

export function createStoreStaffController(app: GwcApp) {
  return {
    list: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listStores(app, { signal: request.deadlineSignal })),

    setActive: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      // `active` was normalised to a boolean by the request schema, so `0` and
      // `false` arrive here as the same thing.
      const { active, reason } = request.body as { active: boolean; reason?: string }
      return reply.send(await setStoreActive(app, {
        storeId: id, active, reason, actor: { id: String(request.principal!.id), requestId: request.id },
      }))
    },
  }
}
