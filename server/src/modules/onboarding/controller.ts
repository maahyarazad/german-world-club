import { register } from './application/register.ts'
import { verifyMobile, sendEmailCode, verifyEmail } from './application/verify.ts'
import { loadStatus } from './application/status.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { RegisterRequest, VerifyMobileRequest, VerifyEmailRequest } from '@gwc/contracts/onboarding'

/**
 * Request and reply shaping for onboarding. Every rule lives in `application/`.
 */
export function createOnboardingController(app: GwcApp) {
  const deviceOf = (request: GwcRequest) => (request.principal?.deviceId as string | null | undefined) ?? null

  return {
    register: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as RegisterRequest
      const result = await register(app, {
        ...body, ip: request.ip, requestId: request.id, signal: request.deadlineSignal,
      })
      // 202: a code is on its way; nothing is usable until it comes back.
      return reply.code(202).send(result)
    },

    verifyMobile: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as VerifyMobileRequest
      const result = await verifyMobile(app, {
        ...body,
        ip: request.ip,
        userAgent: request.headers['user-agent'] as string | undefined,
        requestId: request.id,
      })
      return reply.send(result)
    },

    status: async (request: GwcRequest, reply: GwcReply) =>
      reply.send(await loadStatus(app, { memberId: String(request.principal!.id), signal: request.deadlineSignal })),

    sendEmailCode: async (request: GwcRequest, reply: GwcReply) => {
      const result = await sendEmailCode(app, {
        memberId: String(request.principal!.id),
        deviceId: deviceOf(request),
        signal: request.deadlineSignal,
      })
      return reply.code(202).send(result)
    },

    verifyEmail: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as VerifyEmailRequest
      const status = await verifyEmail(app, {
        memberId: String(request.principal!.id),
        deviceId: deviceOf(request),
        challengeId: body.challengeId,
        code: body.code,
        requestId: request.id,
        signal: request.deadlineSignal,
      })
      return reply.send(status)
    },
  }
}
