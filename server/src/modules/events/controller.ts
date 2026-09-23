import {
  listEvents, decodeEventCursor, getEvent, registerForEvent, cancelRegistration,
} from './application/events.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { RegisterForEventRequest } from '@gwc/contracts/events'

/** Request and reply shaping for member events. The rules live in `application/`. */
export function createEventController(app: GwcApp) {
  const memberOf = (request: GwcRequest) => String(request.principal!.id)

  return {
    list: async (request: GwcRequest, reply: GwcReply) => {
      const q = request.query as { when?: 'upcoming' | 'past'; cursor?: string }
      return reply.send(await listEvents(app, {
        memberId: memberOf(request),
        when: q.when,
        cursor: decodeEventCursor(q.cursor),
        signal: request.deadlineSignal,
      }))
    },

    detail: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      return reply.send(await getEvent(app, { memberId: memberOf(request), eventId: id, signal: request.deadlineSignal }))
    },

    register: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      const registration = await registerForEvent(app, {
        memberId: memberOf(request),
        eventId: id,
        // Defaults were applied by the route schema.
        request: request.body as Required<RegisterForEventRequest>,
        requestId: request.id,
        signal: request.deadlineSignal,
      })
      return reply.code(201).send(registration)
    },

    cancel: async (request: GwcRequest, reply: GwcReply) => {
      const { id } = request.params as { id: string }
      await cancelRegistration(app, { memberId: memberOf(request), eventId: id, requestId: request.id, signal: request.deadlineSignal })
      return reply.code(204).send()
    },
  }
}
