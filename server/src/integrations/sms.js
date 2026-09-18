import { createHmac, randomBytes } from 'node:crypto'
import { requestDependency } from './http-client.js'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * SMS via **SMSGlobal** — the OTP delivery channel (§6.2, FR-012).
 *
 * Declared fallback: **refuse, retry later**. Sign-in is refused with
 * `otp-unavailable` rather than waved through, because the second factor is the
 * control; skipping it when the provider is down turns a supplier outage into
 * an authentication bypass.
 *
 * The retry is safe (`retrySafe: true` in config/breakers.js) for a specific
 * reason: the *same code* stays valid for its five-minute window, so a resend
 * after recovery delivers the code the member is already waiting for rather
 * than invalidating it and starting again.
 */

const DEFAULT_HOST = 'api.smsglobal.com'
const SEND_PATH = '/v2/sms/'

/**
 * SMSGlobal's MAC authentication scheme.
 *
 * Their REST API documents MAC rather than a bearer token, and the signature
 * covers the method, the path, the host and the port — so a signed request
 * cannot be replayed against a different endpoint. The string being signed is
 * newline-delimited and ends with an *empty extension line*, which means a
 * trailing newline: omitting it produces a well-formed-looking signature that
 * the API rejects with a 401 and no explanation, and is the single most common
 * way this integration is mis-implemented.
 */
export function macAuthorization({ apiKey, apiSecret, method, path, host, port, timestamp, nonce }) {
  const ts = timestamp ?? Math.floor(Date.now() / 1000)
  const once = nonce ?? randomBytes(16).toString('hex')

  // timestamp, nonce, method, URI, host, port, ext — then the trailing newline.
  const stringToSign = `${ts}\n${once}\n${method}\n${path}\n${host}\n${port}\n\n`
  const mac = createHmac('sha256', apiSecret).update(stringToSign).digest('base64')

  return `MAC id="${apiKey}", ts="${ts}", nonce="${once}", mac="${mac}"`
}

/**
 * Normalise a number to the bare international form SMSGlobal expects.
 *
 * It wants digits only, with the country code and no leading `+` or `00`. A
 * number stored as `+971 50 123 4567` is accepted by the API in that shape only
 * sometimes, and the failure is silent — the request succeeds and nothing
 * arrives — so it is normalised here rather than trusted from the database.
 */
export function normaliseDestination(mobile) {
  const digits = String(mobile ?? '').replace(/[^\d]/g, '')
  return digits.startsWith('00') ? digits.slice(2) : digits
}

export function createSmsClient({
  apiKey,
  apiSecret,
  origin,
  baseUrl = `https://${DEFAULT_HOST}`,
  send = requestDependency,
} = {}) {
  const url = new URL(baseUrl)
  const host = url.hostname
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')

  return {
    name: 'sms',
    provider: 'smsglobal',
    /** Whether real credentials are present; otherwise sends are logged only. */
    configured: Boolean(apiKey && apiSecret),

    async sendMessage({ destination, message }, { signal } = {}) {
      if (!apiKey || !apiSecret) {
        throw Object.assign(new Error('SMSGlobal credentials are not configured'), {
          code: 'SMS_NOT_CONFIGURED',
        })
      }

      const to = normaliseDestination(destination)
      if (!to) {
        // A malformed number is a business outcome, not a provider failure, so
        // it carries a 4xx and `errorFilter` keeps it off the breaker (FR-036).
        throw Object.assign(new Error('The destination number is not usable.'), { statusCode: 422 })
      }

      const response = await send('sms', `${baseUrl}${SEND_PATH}`, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: macAuthorization({
            apiKey, apiSecret, method: 'POST', path: SEND_PATH, host, port,
          }),
        },
        body: JSON.stringify({ origin, destination: to, message }),
      })

      const result = await response.body.json().catch(() => ({}))
      return { delivered: true, messageId: result?.messages?.[0]?.id ?? result?.id ?? null }
    },

    /**
     * The OTP message itself.
     *
     * Deliberately terse and free of anything that identifies the member. An
     * SMS is rendered on a lock screen, so the club's name plus the code is the
     * most that should ever appear — this is an invite-only organisation and
     * "you are a member of X" is itself the fact §3.1 protects.
     */
    async sendCode({ mobile, code }, { signal } = {}) {
      return this.sendMessage(
        { destination: mobile, message: `${code} is your German World Club verification code. It expires in 5 minutes.` },
        { signal },
      )
    },
  }
}

/** The declared unavailable behaviour: refuse and say when to come back. */
export function smsUnavailable() {
  const error = new Error('The verification code could not be sent.')
  error.problem = { ...PROBLEMS.SERVICE_UNAVAILABLE, title: 'Verification unavailable' }
  error.statusCode = 503
  error.safeDetail = 'A verification code could not be sent right now. Please try again in a few minutes.'
  return error
}
