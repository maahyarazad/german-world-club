import { getPostForStaff, moderatePost, listReports, resolveReport } from './application/moderate.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'

/** Request and reply shaping for Threads moderation. The rules live in `application/moderate.ts`. */
export function createThreadStaffController(app: GwcApp) {
  const adminOf = (request: GwcRequest) => String(request.principal!.id)
  const idOf = (request: GwcRequest) => (request.params as { id: string }).id

  return {
    reports: async (request: GwcRequest, reply: GwcReply) => {
      const { state } = request.query as { state?: 'open' | 'upheld' | 'dismissed' }
      return reply.send({ items: await listReports(app, { state, signal: request.deadlineSignal }) })
    },

    getPost: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await getPostForStaff(app, { postId: idOf(request), signal: request.deadlineSignal })),

    moderate: (action: 'hide' | 'restore' | 'remove') => async (request: GwcRequest, reply: GwcReply) => {
      const { reason } = request.body as { reason: string }
      return reply.send(await moderatePost(app, {
        postId: idOf(request), adminId: adminOf(request), action, reason,
        requestId: request.id, signal: request.deadlineSignal,
      }))
    },

    resolve: async (request: GwcRequest, reply: GwcReply) => {
      const { outcome, note } = request.body as { outcome: 'upheld' | 'dismissed'; note: string }
      return reply.send(await resolveReport(app, {
        reportId: idOf(request), adminId: adminOf(request), outcome, note,
        requestId: request.id, signal: request.deadlineSignal,
      }))
    },
  }
}
