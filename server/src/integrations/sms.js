import { requestDependency } from './http-client.js'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * SMS — the OTP delivery channel (resilience.md §2).
 *
 * Declared fallback: **refuse, retry later**. Sign-in is refused with
 * `otp-unavailable` rather than waved through, because the second factor is the
 * control and skipping it when the provider is down turns an outage into an
 * authentication bypass.
 *
 * The retry is safe (`retrySafe: true`) for a specific reason: the *same code*
 * stays valid for its five-minute window, so a resend after recovery delivers
 * the code the member is already waiting for rather than invalidating it and
 * starting again.
 */

export function createSmsClient({ baseUrl = 'https://sms.invalid', send = requestDependency } = {}) {
  return {
    name: 'sms',

    async sendCode({ mobile, code }, { signal } = {}) {
      const response = await send('sms', `${baseUrl}/messages`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json' },
        // The code is the whole payload; nothing else about the member travels
        // to the provider.
        body: JSON.stringify({ to: mobile, text: `German World Club code: ${code}` }),
      })
      const result = await response.body.json().catch(() => ({}))
      return { delivered: true, messageId: result.messageId ?? null }
    },
  }
}

/** The declared unavailable behaviour: refuse and say when to come back. */
export function smsUnavailable() {
  const error = new Error('The verification code could not be sent.')
  error.problem = { ...PROBLEMS.SERVICE_UNAVAILABLE, type: `${PROBLEMS.SERVICE_UNAVAILABLE.type}`, title: 'Verification unavailable' }
  error.statusCode = 503
  error.safeDetail = 'A verification code could not be sent right now. Please try again in a few minutes.'
  return error
}
