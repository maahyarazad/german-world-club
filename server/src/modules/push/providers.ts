import { createSign } from 'node:crypto'
import { request as undiciRequest } from 'undici'

/**
 * The push transports (feature 011; originally PUSH-NOTIFICATION-BLUEPRINT.md §3.2).
 *
 * Two providers. Each device row carries a `provider` of `expo` or `fcm`, and
 * the dispatcher sends each batch to exactly one of them. **Never send an Expo
 * token to FCM or the reverse** — it hard-fails per token, and the symptom is
 * "push is broken for one cohort of users", which is a long way from the cause.
 *
 * Implemented over `undici` rather than `firebase-admin` and `expo-server-sdk`.
 * Both are thin HTTP clients for our purposes, and `firebase-admin` in
 * particular is a very large dependency to carry for one endpoint. The one
 * thing it provides that has to be rebuilt here is the OAuth2 exchange for
 * FCM's HTTP v1 API, which is forty lines of RS256 below.
 *
 * **Outcomes are classified, not just counted** (research R2). The dispatcher
 * guarantees at most one push per device, so it must know which failures prove
 * the provider did *not* accept a message (safe to retry) and which leave that
 * unknown (never resent):
 *
 *   sent     the provider accepted it; `providerRef` is the Expo ticket id
 *   failed   the provider refused this message; `permanent` = the token is dead
 *   retry    the provider refused the whole request (429/5xx), no connection
 *            was made, or the breaker is open — nothing was accepted
 *   unknown  the request may have been accepted (a timeout, a reset mid-way)
 */

export type PushProvider = 'expo' | 'fcm'

/** Arbitrary payload the client receives; every value is stringified below. */
export type PushData = Record<string, unknown>

/** One message for one device. */
export type PushMessage = {
  token: string
  title: string
  body: string
  data: Record<string, string>
}

export type MessageOutcome =
  | { status: 'sent'; providerRef: string | null }
  | { status: 'failed'; error: string; permanent: boolean }
  /** `notAttempted`: the breaker was open and nothing was sent, so no attempt is spent. */
  | { status: 'retry'; error: string; notAttempted?: boolean }
  | { status: 'unknown'; error: string }

export type ReceiptOutcome =
  | { status: 'ok' }
  | { status: 'error'; error: string; permanent: boolean }

/** What the dispatcher and the receipts job talk to. Injectable, so suites need no network. */
export type PushTransport = {
  /** Outcomes in the same order as `messages`. Never throws. */
  send(provider: PushProvider, messages: readonly PushMessage[]): Promise<MessageOutcome[]>
  /** Expo receipts by ticket id. Ids absent from the result are not ready yet. */
  receipts(ids: readonly string[]): Promise<Record<string, ReceiptOutcome>>
}

/**
 * The undici `request` seam.
 *
 * Typed structurally rather than as undici's own signature so the suites can
 * pass a stub without reconstructing a Dispatcher response.
 */
export type Send = (
  url: string,
  options: { method: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  statusCode: number
  body: { json(): Promise<unknown>; text(): Promise<string> }
}>

/** A breaker, as far as this module is concerned: `app.breakers.<name>`. */
export type BreakerLike = { run<T>(fn: (signal?: AbortSignal) => Promise<T>): Promise<T> }

/** Transport credentials, read from the validated environment. */
export type PushConfig = {
  expoAccessToken?: string
  fcmProjectId?: string
  fcmClientEmail?: string
  fcmPrivateKey?: string
}

/** `catch` binds unknown under strict; this is the one place that unwraps it. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
const EXPO_RECEIPTS_ENDPOINT = 'https://exp.host/--/api/v2/push/getReceipts'
/** Expo accepts at most 100 messages per send request. */
export const EXPO_CHUNK = 100
/** …and at most 1,000 ids per receipts request. */
export const EXPO_RECEIPT_CHUNK = 1000
/** FCM HTTP v1 sends one message per call, so this bounds the concurrency. */
const FCM_CONCURRENCY = 20

// Defined once in @gwc/contracts (feature 012) so the app's development log
// masks a token exactly as the server does. Imported for use below, and
// re-exported for existing callers.
import { tokenPreview } from '@gwc/contracts/push'
export { tokenPreview }

/**
 * Remove every push token from provider text before it is stored or logged.
 *
 * Expo's ticket errors quote the token ("ExponentPushToken[…] is not a
 * registered push notification recipient"). Stored as-is, the delivery history
 * would become a second copy of every dead token, which FR-029 forbids.
 */
export function redactTokens(text: string, tokens: readonly string[] = []): string {
  let out = text.replace(/Expo(?:nent)?PushToken\[[^\]]*\]/g, '[token]')
  for (const token of tokens) if (token.length >= 8) out = out.split(token).join('[token]')
  return out.slice(0, 500)
}

/**
 * Every value in `data` must be a string.
 *
 * FCM rejects non-string data values outright; Expo is lenient, which is worse,
 * because the client then has to handle both shapes and iOS silently drops the
 * payload. Normalised once, here, so neither client ever has to ask.
 */
export function normalizeData(data: PushData = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v ?? '')]))
}

const chunk = <T,>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** A whole-request refusal. `statusCode` lets the breaker's errorFilter tell 4xx from 5xx. */
export class ProviderHttpError extends Error {
  readonly statusCode: number
  constructor(provider: PushProvider, statusCode: number, detail = '') {
    super(`${provider} answered HTTP ${statusCode}${detail ? `: ${detail}` : ''}`)
    this.name = 'ProviderHttpError'
    this.statusCode = statusCode
  }
}

/**
 * Connection failures that happen before a single byte of the request is
 * written. Only these — not a timeout, not a reset — prove nothing was sent.
 */
const NOT_CONNECTED = new Set([
  'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_CONNECT',
])

/**
 * Decide whether a thrown request error proves the message was not accepted.
 *
 * Unwraps the breaker's DependencyUnavailableError to its cause. An open
 * breaker ran nothing at all, so it is a retry; a breaker *timeout* abandoned
 * a request that may well have landed, so it is not.
 */
export function classifyRequestError(
  err: unknown,
): { status: 'retry'; error: string; notAttempted?: boolean } | { status: 'unknown'; error: string } {
  const seen = new Set<unknown>()
  let current: any = err
  while (current && !seen.has(current)) {
    seen.add(current)
    if (current.code === 'EOPENBREAKER') return { status: 'retry', error: 'circuit open', notAttempted: true }
    if (current instanceof ProviderHttpError) {
      const retryable = current.statusCode === 429 || current.statusCode >= 500
      return { status: retryable ? 'retry' : 'unknown', error: current.message }
    }
    if (typeof current.code === 'string' && NOT_CONNECTED.has(current.code)) {
      return { status: 'retry', error: current.code }
    }
    current = current.cause
  }
  return { status: 'unknown', error: messageOf(err) }
}

// ---- Expo -------------------------------------------------------------------

type ExpoTicket = { status?: string; id?: string; message?: string; details?: { error?: string } }

export type SendExpoOptions = {
  messages: readonly PushMessage[]
  /** Required in production: the project runs with enhanced push security (R8). */
  accessToken?: string
  send?: Send
  breaker?: BreakerLike
}

const expoHeaders = (accessToken?: string) => ({
  accept: 'application/json',
  'content-type': 'application/json',
  ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
})

/** Send up to any number of messages to Expo, 100 per request, one request in flight. */
export async function sendExpo({
  messages, accessToken, send = undiciRequest as unknown as Send, breaker,
}: SendExpoOptions): Promise<MessageOutcome[]> {
  const outcomes: MessageOutcome[] = []
  const run = breaker ? <T,>(fn: () => Promise<T>) => breaker.run(fn) : <T,>(fn: () => Promise<T>) => fn()

  for (const batch of chunk(messages, EXPO_CHUNK)) {
    const tokens = batch.map((m) => m.token)
    try {
      const tickets = await run(async () => {
        const response = await send(EXPO_ENDPOINT, {
          method: 'POST',
          headers: expoHeaders(accessToken),
          body: JSON.stringify(batch.map((m) => ({
            to: m.token,
            title: m.title,
            body: m.body,
            data: m.data,
            sound: 'default',
            // Android 8+ shows nothing on a channel that does not exist; the
            // app creates 'default' before it asks for permission (R9).
            channelId: 'default',
          }))),
        })
        if (response.statusCode === 429 || response.statusCode >= 500) {
          await response.body.text().catch(() => '')
          throw new ProviderHttpError('expo', response.statusCode)
        }
        const payload = (await response.body.json().catch(() => null)) as
          | { data?: unknown; errors?: { message?: string }[] }
          | null
        if (response.statusCode >= 300 || !Array.isArray(payload?.data)) {
          // A whole-request refusal such as bad credentials. Retrying the same
          // request cannot help, and each device's failure should say why.
          const detail = payload?.errors?.[0]?.message ?? `HTTP ${response.statusCode}`
          return batch.map((): ExpoTicket => ({ status: 'error', message: detail }))
        }
        return payload.data as ExpoTicket[]
      })

      batch.forEach((_message, index) => {
        const ticket = tickets[index]
        if (ticket?.status === 'ok') {
          outcomes.push({ status: 'sent', providerRef: ticket.id ?? null })
          return
        }
        const permanent = ticket?.details?.error === 'DeviceNotRegistered'
        outcomes.push({
          status: 'failed',
          permanent,
          error: redactTokens(ticket?.details?.error ?? ticket?.message ?? 'no ticket returned', tokens),
        })
      })
    } catch (err) {
      const outcome = classifyRequestError(err)
      for (const _ of batch) outcomes.push({ ...outcome, error: redactTokens(outcome.error, tokens) })
    }
  }
  return outcomes
}

/**
 * Fetch Expo receipts for ticket ids (research R6).
 *
 * A ticket only says Expo accepted the message; the receipt says whether Apple
 * or Google did. `DeviceNotRegistered` usually shows up here rather than on the
 * ticket, which is why this job exists at all.
 */
export async function fetchExpoReceipts({
  ids, accessToken, send = undiciRequest as unknown as Send, breaker,
}: { ids: readonly string[]; accessToken?: string; send?: Send; breaker?: BreakerLike }) {
  const out: Record<string, ReceiptOutcome> = {}
  const run = breaker ? <T,>(fn: () => Promise<T>) => breaker.run(fn) : <T,>(fn: () => Promise<T>) => fn()

  for (const batch of chunk(ids, EXPO_RECEIPT_CHUNK)) {
    const data = await run(async () => {
      const response = await send(EXPO_RECEIPTS_ENDPOINT, {
        method: 'POST',
        headers: expoHeaders(accessToken),
        body: JSON.stringify({ ids: batch }),
      })
      if (response.statusCode >= 300) {
        await response.body.text().catch(() => '')
        throw new ProviderHttpError('expo', response.statusCode)
      }
      const payload = (await response.body.json()) as { data?: Record<string, ExpoTicket> } | null
      return payload?.data ?? {}
    })
    for (const [id, receipt] of Object.entries(data)) {
      out[id] = receipt.status === 'ok'
        ? { status: 'ok' }
        : {
            status: 'error',
            permanent: receipt.details?.error === 'DeviceNotRegistered',
            error: redactTokens(receipt.details?.error ?? receipt.message ?? 'receipt error'),
          }
    }
  }
  return out
}

// ---- FCM --------------------------------------------------------------------

/**
 * Exchange the service account for an OAuth2 access token.
 *
 * Cached until shortly before expiry: the exchange is a network round trip and
 * a token is good for an hour, so doing it per send would add latency to every
 * broadcast for no reason. The 60-second margin covers clock skew between here
 * and Google.
 */
type TokenSourceOptions = { clientEmail: string; privateKey: string; send?: Send }

function createTokenSource({
  clientEmail, privateKey, send = undiciRequest as unknown as Send,
}: TokenSourceOptions) {
  let cached: { value: string; expiresAt: number } | null = null
  /**
   * The *in-flight* exchange, not just the finished one.
   *
   * Sends run concurrently, so caching only the resolved token lets every
   * request in the first batch miss the cache and start its own exchange. On a
   * club-wide broadcast that is hundreds of simultaneous OAuth calls, which
   * Google throttles — and the symptom is a broadcast that half-delivers for no
   * visible reason. Memoising the promise collapses them into one.
   */
  let inFlight: Promise<string> | null = null

  return async function accessToken(): Promise<string> {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.value
    if (inFlight) return inFlight

    inFlight = exchange().finally(() => { inFlight = null })
    return inFlight
  }

  async function exchange(): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const claims = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }

    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${b64(header)}.${b64(claims)}`
    const signature = createSign('RSA-SHA256')
      .update(unsigned)
      .sign(privateKey.replace(/\\n/g, '\n'), 'base64url')

    const response = await send('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }).toString(),
    })

    const payload = (await response.body.json()) as
      | { access_token?: string; expires_in?: number; error_description?: string }
      | null
    if (!payload?.access_token) {
      // Thrown before any message request is written, so nothing was sent.
      throw Object.assign(
        new Error(`FCM token exchange failed: ${payload?.error_description ?? 'no access_token'}`),
        { code: response.statusCode >= 500 ? 'UND_ERR_CONNECT' : undefined },
      )
    }

    cached = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 }
    return cached.value
  }
}

export type SendFcmOptions = {
  messages: readonly PushMessage[]
  projectId?: string
  clientEmail?: string
  privateKey?: string
  send?: Send
  breaker?: BreakerLike
  /** Reused across calls so the OAuth token is too. */
  accessToken?: () => Promise<string>
}

export async function sendFcm({
  messages, projectId, clientEmail, privateKey,
  send = undiciRequest as unknown as Send, breaker, accessToken,
}: SendFcmOptions): Promise<MessageOutcome[]> {
  if (!projectId || !clientEmail || !privateKey) {
    // env.ts refuses a partial set at boot, so this is "no FCM at all". Failed,
    // not retried: no amount of waiting configures credentials.
    return messages.map(() => ({ status: 'failed', permanent: false, error: 'FCM credentials are not configured' }))
  }

  const token = accessToken ?? createTokenSource({ clientEmail, privateKey, send })
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
  const run = breaker ? <T,>(fn: () => Promise<T>) => breaker.run(fn) : <T,>(fn: () => Promise<T>) => fn()

  const deliver = async (message: PushMessage): Promise<MessageOutcome> => {
    try {
      return await run(async (): Promise<MessageOutcome> => {
        const bearer = await token()
        const response = await send(endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              data: message.data,
              android: { priority: 'HIGH', notification: { sound: 'default', channel_id: 'default' } },
              apns: { payload: { aps: { sound: 'default' } } },
            },
          }),
        })
        if (response.statusCode === 429 || response.statusCode >= 500) {
          await response.body.text().catch(() => '')
          throw new ProviderHttpError('fcm', response.statusCode)
        }
        if (response.statusCode >= 300) {
          const detail = await response.body.text().catch(() => '')
          // 404 / UNREGISTERED is FCM saying the app was uninstalled (FR-027).
          const permanent = response.statusCode === 404 || detail.includes('UNREGISTERED')
          return {
            status: 'failed',
            permanent,
            error: redactTokens(permanent ? 'UNREGISTERED' : detail.slice(0, 200) || `HTTP ${response.statusCode}`, [message.token]),
          }
        }
        const payload = (await response.body.json().catch(() => null)) as { name?: string } | null
        return { status: 'sent', providerRef: payload?.name ?? null }
      })
    } catch (err) {
      const outcome = classifyRequestError(err)
      return { ...outcome, error: redactTokens(outcome.error, [message.token]) }
    }
  }

  const outcomes: MessageOutcome[] = []
  for (const batch of chunk(messages, FCM_CONCURRENCY)) outcomes.push(...(await Promise.all(batch.map(deliver))))
  return outcomes
}

// ---- Transports -------------------------------------------------------------

/**
 * The real transport, each provider behind its own breaker (research R7).
 *
 * `breakers` is `app.breakers`; absent (a unit test), calls run bare.
 */
export function createPushTransport({
  config = {}, breakers, send,
}: { config?: PushConfig; breakers?: Record<string, BreakerLike>; send?: Send } = {}): PushTransport {
  const fcmToken = config.fcmClientEmail && config.fcmPrivateKey
    ? createTokenSource({ clientEmail: config.fcmClientEmail, privateKey: config.fcmPrivateKey, send })
    : undefined

  return {
    async send(provider, messages) {
      if (messages.length === 0) return []
      if (provider === 'expo') {
        return sendExpo({ messages, accessToken: config.expoAccessToken, send, breaker: breakers?.pushExpo })
      }
      return sendFcm({
        messages,
        projectId: config.fcmProjectId,
        clientEmail: config.fcmClientEmail,
        privateKey: config.fcmPrivateKey,
        accessToken: fcmToken,
        send,
        breaker: breakers?.pushFcm,
      })
    },
    async receipts(ids) {
      if (ids.length === 0) return {}
      return fetchExpoReceipts({ ids, accessToken: config.expoAccessToken, send, breaker: breakers?.pushExpo })
    },
  }
}

/**
 * Development without credentials: log what would have been sent (research R8).
 *
 * The same bargain queued mail makes in development — onboarding and staff
 * sends can be finished on a laptop. Only the token *preview* is logged; the
 * token itself never reaches a log line (tests/ops/logging-redaction.test.ts).
 */
export function createLoggingTransport(log: { info(obj: object, msg: string): void }): PushTransport {
  return {
    async send(provider, messages) {
      for (const message of messages) {
        log.info(
          { provider, tokenPreview: tokenPreview(message.token), title: message.title, data: message.data },
          'push (logging transport): would send',
        )
      }
      return messages.map(() => ({ status: 'sent', providerRef: null }))
    },
    async receipts() {
      return {}
    },
  }
}
