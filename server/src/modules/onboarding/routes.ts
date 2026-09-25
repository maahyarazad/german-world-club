import fp from 'fastify-plugin'
import {
  registerRequestSchema, registerResponseSchema,
  verifyMobileRequestSchema, verifyMobileResponseSchema,
  emailCodeSentSchema, verifyEmailRequestSchema, onboardingStatusSchema,
  changeContactRequestSchema,
} from '@gwc/contracts/onboarding'
import { createOnboardingController } from './controller.ts'
import type { GwcApp } from '../../app.ts'

/**
 * Mobile onboarding, Phase 1 (§6.1, feature 009): schema, posture and wiring.
 * The rules live in `application/`.
 *
 * Two postures, and the difference is the point:
 *
 *   - `register` and `verify-mobile` are **public**. They are how an applicant
 *     gets a credential at all. Both fail closed on their rate limits, since
 *     one sends an SMS per call and the other guesses at a 4-digit code.
 *   - Everything after that is **`onboarding: true`** — a member route that
 *     an applicant not yet approved may reach. 10-auth lifts the approval,
 *     email and device gates for exactly these routes and no others, and
 *     11-rbac refuses the flag on anything but a member route.
 */
export default fp(
  async function onboardingRoutes(app: GwcApp) {
    const controller = createOnboardingController(app)

    // Credentials and codes pass through here; nothing of it may be cached.
    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/onboarding/')) reply.header('cache-control', 'private, no-store')
      return payload
    })

    const onboarding = { audience: 'member', onboarding: true } as const

    app.post(
      '/onboarding/register',
      {
        // 'otp-send': the request waits on the SMS provider, inline and on
        // purpose (application/register.ts says why).
        config: { auth: { audience: 'public' }, budget: 'otp-send', rateLimit: app.bucket('register') },
        schema: { body: registerRequestSchema, response: { 202: registerResponseSchema } },
      },
      controller.register,
    )

    // Step 3's correction of a mistyped email or number (application/contact.ts).
    // Same budget and bucket as register: it too texts a code, inline.
    app.post(
      '/onboarding/contact',
      {
        config: { auth: { audience: 'public' }, budget: 'otp-send', rateLimit: app.bucket('register') },
        schema: { body: changeContactRequestSchema, response: { 202: registerResponseSchema } },
      },
      controller.changeContact,
    )

    app.post(
      '/onboarding/verify-mobile',
      {
        config: { auth: { audience: 'public' }, budget: 'auth', rateLimit: app.bucket('otp-verify') },
        schema: { body: verifyMobileRequestSchema, response: { 200: verifyMobileResponseSchema } },
      },
      controller.verifyMobile,
    )

    app.get(
      '/onboarding/status',
      {
        config: { auth: onboarding, budget: 'member-read' },
        onRequest: app.guard,
        schema: { response: { 200: onboardingStatusSchema } },
      },
      controller.status,
    )

    app.post(
      '/onboarding/email/send',
      {
        config: { auth: onboarding, budget: 'auth', rateLimit: app.bucket('email-code-send') },
        onRequest: app.guard,
        schema: { response: { 202: emailCodeSentSchema } },
      },
      controller.sendEmailCode,
    )

    app.post(
      '/onboarding/email/verify',
      {
        config: { auth: onboarding, budget: 'auth', rateLimit: app.bucket('otp-verify') },
        onRequest: app.guard,
        schema: { body: verifyEmailRequestSchema, response: { 200: onboardingStatusSchema } },
      },
      controller.verifyEmail,
    )
  },
  { name: 'onboarding-routes', dependencies: ['auth', 'rate-limit'] },
)
