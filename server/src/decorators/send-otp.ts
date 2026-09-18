import { smsUnavailable } from '../integrations/sms.ts'
import type { GwcApp } from '../app.ts'

/**
 * OTP delivery (FR-012, §6.2).
 *
 * The auth module calls this after minting a challenge. It was previously
 * optional-chained against nothing at all, so codes were generated and never
 * sent — the challenge was real, the SMS was not.
 *
 * Runs under the SMS breaker with its declared fallback: refuse and tell the
 * member to retry. Waving sign-in through when the provider is down would
 * turn a supplier outage into an authentication bypass, which is why this
 * throws rather than resolving quietly.
 *
 * Depends on `app.integrations` (registerIntegrations) and `app.breakers`
 * (13-breakers.js) already being present.
 */
export function registerSendOtp(app: GwcApp) {
  app.decorate('sendOtp', async ({ mobile, code }, { signal } = {}) => {
    if (!app.integrations.sms.configured) {
      // Loud rather than silent. A second factor that does not send is not a
      // second factor, and in development this is the line that says so.
      app.log.error({ mobile: `••••${String(mobile).slice(-4)}` }, 'SMSGlobal is not configured — no code was sent')
      throw smsUnavailable()
    }

    try {
      return await app.breakers.sms.run((s) => app.integrations.sms.sendCode({ mobile, code }, { signal: s ?? signal }))
    } catch (err) {
      // A 4xx from the provider (an unusable number) is already a business
      // outcome and passes through; anything else becomes the declared refusal.
      if (err.statusCode >= 400 && err.statusCode < 500) throw err
      app.log.error({ err }, 'OTP delivery failed')
      throw smsUnavailable()
    }
  })
}
