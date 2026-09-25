import { register } from './application/register.ts'
import { changeContact } from './application/contact.ts'
import { verifyMobile, sendEmailCode, verifyEmail } from './application/verify.ts'
import { loadStatus } from './application/status.ts'
import { setAuthCookies } from '../auth/cookies.ts'
import type { GwcReply, GwcRequest } from '../../types/handlers.ts'
import type { GwcApp } from '../../app.ts'
import type { RegisterRequest, VerifyMobileRequest, VerifyEmailRequest, ChangeContactRequest } from '@gwc/contracts/onboarding'

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

    changeContact: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as ChangeContactRequest
      const result = await changeContact(app, { ...body, requestId: request.id, signal: request.deadlineSignal })
      // 202, like register: a new code is on its way.
      return reply.code(202).send(result)
    },

    verifyMobile: async (request: GwcRequest, reply: GwcReply) => {
      const body = request.body as VerifyMobileRequest
      const { face, accessToken, refreshToken, ...rest } = await verifyMobile(app, {
        ...body,
        ip: request.ip,
        userAgent: request.headers['user-agent'] as string | undefined,
        requestId: request.id,
      })
      // Exactly what sign-in does per face: the browser gets httpOnly cookies
      // and never sees a token; the app gets the pair in the body.
      if (face === 'web') {
        setAuthCookies(reply, { accessToken, refreshToken, secure: app.env.isProduction })
        return reply.send(rest)
      }
      return reply.send({ ...rest, accessToken, refreshToken })
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
