import { smsUnavailable, smsDestinationRefused, smsDestinationInvalid } from '../integrations/sms.ts'
import { createSmsCountryPolicy } from '../integrations/sms-country-policy.ts'
import type { GwcApp } from '../app.ts'

/**
 * The one way this server sends an SMS: `app.sendOtp`.
 *
 * 1. The country policy (integrations/sms-country-policy.ts). A refused number
 *    is logged masked and answered with `sms-destination-not-allowed` (422).
 * 2. SMSGlobal must be configured; if not, refuse rather than skip the code.
 * 3. Send. A provider error is logged with SMSGlobal's own response and answered
 *    with a 503 "try again later" — never waved through, because a sign-in without
 *    its second factor would be an authentication bypass. ONE exception (feature
 *    031): a 400 that names the `destination` means the number itself cannot
 *    receive an SMS, so it is a 422 `invalid-mobile`; "try again in a few minutes"
 *    would be a lie about a number that will never work.
 *
 * Verifying a code is not gated (modules/auth/otp.ts), so a code sent before
 * the allowlist narrowed still redeems.
 */

export type SendOtpInput = {
  mobile: string
  code: string
  /** Where the send came from, for the logs: `auth.sign-in`, `onboarding.register`, … */
  route: string
  accountId?: string | null
}

export function registerSendOtp(app: GwcApp) {
  const env = app.env as { SMS_BLOCKED_COUNTRIES?: string; SMS_ALLOWED_COUNTRIES?: string }
  const policy = createSmsCountryPolicy({
    blockedOverride: env.SMS_BLOCKED_COUNTRIES,
    allowedFilter: env.SMS_ALLOWED_COUNTRIES,
    warn: (message) => app.log.warn(message),
  })
  const sms = app.integrations.sms as {
    configured: boolean
    sendCode(input: { mobile: string; code: string }): Promise<unknown>
  }

  /** Throws the 422 for a number the club does not text. The log never holds the full number. */
  const assertSmsDestination = (mobile: string, route: string, accountId: string | null = null) => {
    const decision = policy.resolveDestination(mobile)
    if (decision.allowed) return decision
    app.log.warn({
      route, accountId, dialingCode: decision.dialingCode, country: decision.name,
      reason: decision.reason, destination: decision.maskedDestination,
    }, 'SMS_BLOCKED_COUNTRY')
    throw smsDestinationRefused()
  }
  app.decorate('assertSmsDestination', assertSmsDestination)

  app.decorate('sendOtp', async ({ mobile, code, route, accountId = null }: SendOtpInput) => {
    const { maskedDestination } = assertSmsDestination(mobile, route, accountId)

    if (!sms.configured) {
      app.log.error({ route, destination: maskedDestination }, 'SMSGlobal is not configured — no code was sent')
      throw smsUnavailable()
    }

    try {
      return await sms.sendCode({ mobile, code })
    } catch (err) {
      // The SDK rejects with SMSGlobal's answer, e.g. { statusCode: 400,
      // data: { errors: { origin: … } } } for an unregistered sender id.
      const failure = err as { statusCode?: number; data?: unknown; message?: string }
      const errors = (failure?.data as { errors?: Record<string, unknown> } | undefined)?.errors
      if (failure?.statusCode === 400 && errors && typeof errors === 'object' && 'destination' in errors) {
        app.log.warn({
          route, destination: maskedDestination, providerStatus: 400, providerResponse: failure.data,
        }, 'SMS_DESTINATION_REFUSED')
        throw smsDestinationInvalid()
      }
      app.log.error({
        route, destination: maskedDestination,
        providerStatus: failure?.statusCode ?? null, providerResponse: failure?.data ?? failure?.message ?? String(err),
      }, 'SMS_PROVIDER_ERROR')
      throw smsUnavailable()
    }
  })

  app.log.info({ countries: policy.activeCountries().length, blocked: [...policy.blockedCodes()] }, 'SMS_ALLOWLIST_ACTIVE')
}
