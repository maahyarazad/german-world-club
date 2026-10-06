import { randomInt, randomUUID } from 'node:crypto'
import { buildApp } from '../../src/app.ts'
import { createFixtureContentSource } from '../../src/modules/public/content.ts'
import { createPaymentsClient } from '../../src/integrations/payments.ts'
import { createGeocodingClient } from '../../src/integrations/geocoding.ts'
import type { BuildAppOptions, GwcApp } from '../../src/app.ts'

type SentMail = { to: string; template: string; variables: Record<string, unknown> }

/** What each app's mail recorder has sent, for `emailCodeFor`. */
const mailSent = new WeakMap<GwcApp, SentMail[]>()

/**
 * An app whose SMS and mail providers are recorders.
 *
 * Onboarding cannot be driven without reading the code that was sent, and the
 * only honest place to read it is where it was sent to — for the email code
 * that is the mail provider itself, since it is sent instantly and never
 * queued. Set `mail.failing` to make every send throw. Everything else is the
 * real integration set, so the suite exercises the same wiring that boots.
 */
export async function buildOnboardingApp(options: BuildAppOptions = {}) {
  const sms: { mobile: string; code: string }[] = []
  const sent: SentMail[] = []
  const mail = {
    failing: false,
    sent,
    configured: true,
    send: async (message: SentMail) => {
      if (mail.failing) throw Object.assign(new Error('mail provider down'), { statusCode: 503 })
      sent.push(message)
      return { delivered: true }
    },
  }
  const app = await buildApp({
    ...options,
    contentSource: createFixtureContentSource([]),
    integrations: {
      payments: createPaymentsClient(),
      mail,
      geocoding: createGeocodingClient(),
      sms: {
        configured: true,
        sendCode: async ({ mobile, code }: { mobile: string; code: string }) => {
          sms.push({ mobile, code })
          return { delivered: true }
        },
      },
    },
  })
  await app.ready()
  mailSent.set(app, sent)
  return { app, sms, mail }
}

export const DEVICE = 'device-applicant'

let addressCounter = 0
/**
 * A distinct client address per registration. `register` is an IP bucket of
 * five an hour, so one address for a whole suite would turn every test after
 * the fifth into a test of the rate limiter — which has a test of its own.
 */
export const nextAddress = () => `10.20.${Math.floor(addressCounter / 250)}.${(addressCounter++ % 250) + 1}`

export const register = (app: GwcApp, payload: Record<string, unknown>, remoteAddress = nextAddress()) =>
  app.inject({ method: 'POST', url: '/onboarding/register', payload, remoteAddress })

/**
 * A distinct mobile number per applicant: members.mobile is unique (migration
 * 031), and suites share one database. The fixed 5678 ending keeps the masked
 * "•••• 5678" that several assertions read.
 */
export const uniqueMobile = () => `+4915${String(randomInt(0, 1_000_000)).padStart(6, '0')}5678`

export function applicant(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Anna Applicant',
    email: `applicant-${randomUUID()}@test.invalid`,
    password: 'correct-horse-battery',
    mobile: uniqueMobile(),
    birthday: '1990-04-12',
    gender: 'female',
    countryOfResidence: 'DE',
    ageConfirmed: true,
    primaryLanguage: 'german',
    deviceId: DEVICE,
    ...overrides,
  }
}

/** The latest email code sent to an address, read from the mail recorder. */
export async function emailCodeFor(app: GwcApp, email: string) {
  const latest = (mailSent.get(app) ?? [])
    .filter((m) => m.to === email && m.template === 'onboarding.email-code')
    .at(-1)
  return latest?.variables.code as string | undefined
}

/**
 * Walk an applicant through every step up to "waiting for approval", through
 * the real endpoints. Returns what the app would be holding at that point.
 */
export async function submitApplication(app: GwcApp, sms: { code: string }[], details = applicant()) {
  const registered = await register(app, details)
  const { challengeId } = registered.json()
  const code = sms[sms.length - 1]!.code

  const verified = await app.inject({
    method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code, deviceId: details.deviceId },
  })
  const tokens = verified.json()
  const headers = { authorization: `Bearer ${tokens.accessToken}` }

  const sent = await app.inject({ method: 'POST', url: '/onboarding/email/send', headers })
  const emailCode = await emailCodeFor(app, String(details.email))
  const confirmed = await app.inject({
    method: 'POST', url: '/onboarding/email/verify', headers,
    payload: { challengeId: sent.json().challengeId, code: emailCode },
  })

  return { details, tokens, headers, memberId: String(tokens.principal.id), status: confirmed.json() }
}
