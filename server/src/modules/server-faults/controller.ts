import { PROBLEMS } from '@gwc/contracts/errors'
import { forbidden } from '../../authz/require-permission.ts'
import { lookupByRequestId } from './application/lookup.ts'
import { listServerFaults } from './application/list.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for server fault records. The reads live in `application/`. */
export function createServerFaultsController(app: GwcApp) {
  return {
    list: async (request: GwcRequest, reply: GwcReply) => {
      const { before, fingerprint, clientRequestId, limit = 50 } = request.query as {
        before?: string; fingerprint?: string; clientRequestId?: string; limit?: number
      }
      const page = await listServerFaults(app, {
        before, fingerprint, clientRequestId, limit, signal: request.deadlineSignal,
      })
      return reply.send(page)
    },

    lookup: async (request: GwcRequest, reply: GwcReply) => {
      const { requestId } = request.params as { requestId: string }
      const item = await lookupByRequestId(app, { requestId, signal: request.deadlineSignal })
      // Thrown, so the error handler builds the same 404 envelope as any
      // absent resource — it must not say whether the request existed and
      // succeeded, or expired from retention.
      if (!item) throw forbidden(PROBLEMS.NOT_FOUND, 'No fault is recorded for this request id.')
      return reply.send({ item })
    },
  }
}
