import { createSign } from 'node:crypto'
import { request as undiciRequest } from 'undici'

/**
 * The push dispatcher (PUSH-NOTIFICATION-BLUEPRINT.md §3.2).
 *
 * Two transports, one pipeline. Each device row carries a `provider` of `expo`
 * or `fcm`; `sendToDevices` splits the recipient list on that column, fans out
 * to both, and merges the counts. **Never send an Expo token to FCM or the
 * reverse** — it hard-fails per token, and the symptom is "push is broken for
 * one cohort of users", which is a long way from the cause.
 *
 * Implemented over `undici` rather than `firebase-admin` and `expo-server-sdk`.
 * Both are thin HTTP clients for our purposes, and `firebase-admin` in
 * particular is a very large dependency to carry for one endpoint. The one
 * thing it provides that has to be rebuilt here is the OAuth2 exchange for
 * FCM's HTTP v1 API, which is forty lines of RS256 below.
 */

/** The two transports a device row can name. */
export type PushProvider = 'expo' | 'fcm'

/** Arbitrary payload the client receives; every value is stringified below. */
export type PushData = Record<string, unknown>

/** One device's outcome. `error` is null exactly when status is 'delivered'. */
export type DeliveryResult = {
  token: string
  provider: PushProvider
  status: 'delivered' | 'failed'
  error: string | null
}

/** One transport's outcome for a whole send. */
export type SendResult = {
  provider: PushProvider
  successCount: number
  failureCount: number
  results: DeliveryResult[]
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

/** `catch` binds unknown under strict; this is the one place that unwraps it. */
const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send'
/** Expo accepts at most 100 messages per request. */
const EXPO_CHUNK = 100
/** FCM HTTP v1 sends one message per call, so this bounds the concurrency. */
const FCM_CONCURRENCY = 20

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

// ---- Expo -------------------------------------------------------------------

export type SendExpoOptions = {
  tokens?: readonly (string | null | undefined)[]
  title: string
  body: string
  data?: PushData
  /** Only needed when the Expo project enables enhanced security. */
  accessToken?: string
  send?: Send
}

export async function sendExpo({
  tokens, title, body, data = {}, accessToken, send = undiciRequest as unknown as Send,
}: SendExpoOptions): Promise<SendResult> {
  const clean = [...new Set((tokens ?? []).filter(Boolean))] as string[]
  if (clean.length === 0) return { provider: 'expo', successCount: 0, failureCount: 0, results: [] }

  const results: DeliveryResult[] = []
  let successCount = 0
  let failureCount = 0

  for (const batch of chunk(clean, EXPO_CHUNK)) {
    const messages = batch.map((to: string) => ({ to, sound: 'default', title, body, data: normalizeData(data) }))

    try {
      const response = await send(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          // Only needed when the Expo project enables enhanced security.
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
      })

      const payload = (await response.body.json()) as { data?: unknown } | null
      const tickets: { status?: string; message?: string }[] =
        Array.isArray(payload?.data) ? payload.data : []

      batch.forEach((token: string, index: number) => {
        const ticket = tickets[index]
        const ok = ticket?.status === 'ok'
        if (ok) successCount += 1
        else failureCount += 1
        results.push({
          token,
          provider: 'expo',
          status: ok ? 'delivered' : 'failed',
          error: ok ? null : (ticket?.message ?? 'no ticket returned'),
        })
      })
    } catch (err) {
      // A transport failure fails only this batch; the other provider and the
      // remaining batches still go out.
      failureCount += batch.length
      for (const token of batch) {
        results.push({ token, provider: 'expo', status: 'failed', error: messageOf(err) })
      }
    }
  }

  return { provider: 'expo', successCount, failureCount, results }
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
      throw new Error(`FCM token exchange failed: ${payload?.error_description ?? 'no access_token'}`)
    }

    cached = { value: payload.access_token, expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000 }
    return cached.value
  }
}

export type SendFcmOptions = {
  tokens?: readonly (string | null | undefined)[]
  title: string
  body: string
  data?: PushData
  projectId?: string
  clientEmail?: string
  privateKey?: string
  send?: Send
}

export async function sendFcm({
  tokens, title, body, data = {}, projectId, clientEmail, privateKey,
  send = undiciRequest as unknown as Send,
}: SendFcmOptions): Promise<SendResult> {
  const clean = [...new Set((tokens ?? []).filter(Boolean))] as string[]
  if (clean.length === 0) return { provider: 'fcm', successCount: 0, failureCount: 0, results: [] }

  if (!projectId || !clientEmail || !privateKey) {
    return {
      provider: 'fcm',
      successCount: 0,
      failureCount: clean.length,
      results: clean.map((token: string): DeliveryResult => ({
        token, provider: 'fcm', status: 'failed', error: 'FCM credentials are not configured',
      })),
    }
  }

  const accessToken = createTokenSource({ clientEmail, privateKey, send })
  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
  const results: DeliveryResult[] = []
  let successCount = 0
  let failureCount = 0

  const deliver = async (token: string): Promise<DeliveryResult> => {
    try {
      const response = await send(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: normalizeData(data),
            android: { priority: 'HIGH', notification: { sound: 'default' } },
            apns: { payload: { aps: { sound: 'default' } } },
          },
        }),
      })

      if (response.statusCode >= 300) {
        const detail = await response.body.text().catch(() => '')
        return { token, provider: 'fcm', status: 'failed', error: detail.slice(0, 200) || `HTTP ${response.statusCode}` }
      }

      await response.body.text().catch(() => '')
      return { token, provider: 'fcm', status: 'delivered', error: null }
    } catch (err) {
      return { token, provider: 'fcm', status: 'failed', error: messageOf(err) }
    }
  }

  for (const batch of chunk(clean, FCM_CONCURRENCY)) {
    const settled = await Promise.all(batch.map(deliver))
    for (const result of settled) {
      if (result.status === 'delivered') successCount += 1
      else failureCount += 1
      results.push(result)
    }
  }

  return { provider: 'fcm', successCount, failureCount, results }
}

// ---- The split --------------------------------------------------------------

/**
 * Fan out to both transports and merge the counts. Callers only ever use this.
 *
 * @param devices rows from `push_devices`, each carrying `token` and `provider`
 */
/** A row from `push_devices`, as far as this module is concerned. */
export type PushDevice = { token?: string | null; provider?: PushProvider | string }

/** Transport credentials, read from the validated environment. */
export type PushConfig = {
  expoAccessToken?: string
  fcmProjectId?: string
  fcmClientEmail?: string
  fcmPrivateKey?: string
}

export type SendToDevicesOptions = {
  devices?: readonly PushDevice[]
  title: string
  body: string
  data?: PushData
  config?: PushConfig
  send?: Send
}

export async function sendToDevices({
  devices = [], title, body, data = {}, config = {}, send,
}: SendToDevicesOptions) {
  const expoTokens: string[] = []
  const fcmTokens: string[] = []

  for (const device of devices) {
    if (!device?.token) continue
    ;(device.provider === 'expo' ? expoTokens : fcmTokens).push(device.token)
  }

  // Both transports run even if one throws internally — each catches its own,
  // so an Expo outage does not suppress delivery to FCM devices.
  const [expo, fcm] = await Promise.all([
    sendExpo({ tokens: expoTokens, title, body, data, accessToken: config.expoAccessToken, send }),
    sendFcm({
      tokens: fcmTokens, title, body, data,
      projectId: config.fcmProjectId,
      clientEmail: config.fcmClientEmail,
      privateKey: config.fcmPrivateKey,
      send,
    }),
  ])

  const byToken = new Map<string, DeliveryResult>()
  for (const result of [...expo.results, ...fcm.results]) byToken.set(result.token, result)

  return {
    successCount: expo.successCount + fcm.successCount,
    failureCount: expo.failureCount + fcm.failureCount,
    expo,
    fcm,
    /** Per-device outcome, in the order the devices were given. */
    perDevice: devices.map((device: PushDevice) => ({
      device,
      ...((device.token ? byToken.get(device.token) : undefined) ??
        { status: 'failed', error: 'no token', provider: device.provider }),
    })),
  }
}
