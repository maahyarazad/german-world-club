import { listDevices } from './application/list.ts'
import { endDevice } from './application/end.ts'
import { clearAuthCookies } from '../auth/cookies.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for the member's device list. The rules live in `application/`. */
export function createDevicesController(app: GwcApp) {
  return {
    list: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await listDevices(app, {
        memberId: String(request.principal!.id),
        sessionId: String(request.principal!.sid),
        signal: request.deadlineSignal,
      })),

    end: async (request: GwcRequest, reply: GwcReply) => {
      const result = await endDevice(app, {
        memberId: String(request.principal!.id),
        sessionId: String(request.principal!.sid),
        deviceId: (request.params as { id: string }).id,
        requestId: request.id,
      })
      // Ending the browser you are on is signing out of it.
      if (result.current) clearAuthCookies(reply)
      return reply.code(204).send()
    },
  }
}
