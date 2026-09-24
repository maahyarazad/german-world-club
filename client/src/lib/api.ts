import { PROBLEMS } from '@gwc/contracts/errors'
import type { ProblemResponse } from '@gwc/contracts/errors'
import type {
  AudienceKind, CampaignRequestInput, Notification, NotificationKind, NotificationList, PushAudience,
  TestRecipientAdd, TestRecipientList,
} from '@gwc/contracts/push'
import { describeProblem, isRetryable, requiresReauthentication, invalidatesCapabilities } from './problems'
import type { DescribedProblem } from './problems'

/**
 * The one way the console talks to the API.
 *
 * The browser face authenticates by cookie — `credentials: 'include'` is the
 * whole of it — while the mobile face uses a bearer token. Constitution
 * Principle I permits the *mechanism* to differ per client; the authorization
 * *outcome* is identical because the server resolves it the same way for both.
 */

/** Thrown for any non-2xx. Carries the parsed problem, never a bare message. */
/**
 * What ApiError needs from a response.
 *
 * Narrower than `Response` on purpose: only `status` and `headers.get` are
 * read. Demanding a full Response would force every suite that exercises a
 * refusal to build one, which is a lot of ceremony for two fields.
 */
export type ResponseLike = { status?: number; headers?: { get(name: string): string | null } }

export class ApiError extends Error {
  readonly problem: ProblemResponse
  readonly status: number
  readonly described: DescribedProblem
  /** Seconds to wait, from `retry-after`. Null when the server did not say. */
  readonly retryAfter: number | null

  constructor(problem: ProblemResponse, response?: ResponseLike) {
    const described = describeProblem(problem)
    super(described.title)
    this.name = 'ApiError'
    this.problem = problem
    this.status = response?.status ?? problem?.status ?? 0
    this.described = described
    this.retryAfter = readRetryAfter(response)
  }

  get retryable(): boolean {
    return isRetryable(this.problem)
  }

  get needsSignIn(): boolean {
    return requiresReauthentication(this.problem)
  }

  /**
   * True when this refusal means our capability snapshot is out of date.
   *
   * A grant can be revoked between the sidebar rendering and the click that
   * follows it. The refusal is the signal that our copy is stale, and the
   * correct response is to re-fetch it — not to show a broken screen and not
   * to keep rendering a link the server will keep refusing (FR-016).
   */
  get capabilitiesStale(): boolean {
    return invalidatesCapabilities(this.problem)
  }
}

function readRetryAfter(response?: ResponseLike): number | null {
  const header = response?.headers?.get?.('retry-after')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : null
}

const PROBLEM_TYPE = 'application/problem+json'

/**
 * The CSRF token, cached for the life of the page.
 *
 * The browser face authenticates by cookie, so every state-changing request
 * needs a double-submit token: the server holds a secret in a cookie the page
 * cannot read, and the page echoes the matching token in `x-csrf-token`. An
 * attacker's page can cause the cookie to be sent but cannot read it, which is
 * what makes the pair meaningful.
 *
 * Held in memory rather than storage: it is per-page-load by design, and a
 * token in localStorage on a shared staff workstation outlives the session it
 * belongs to.
 */
let csrfToken: string | null = null
let csrfInFlight: Promise<string | null> | null = null

async function fetchCsrfToken(): Promise<string | null> {
  // Coalesced: several writes firing at once must not mint several secrets,
  // because each call replaces the cookie and would invalidate the others.
  csrfInFlight ??= fetch('/auth/csrf', { credentials: 'include', cache: 'no-store' })
    .then((response) => (response.ok ? response.json() : null))
    .then((body) => {
      csrfToken = body?.csrfToken ?? null
      return csrfToken
    })
    // Never throws. A failure here must not become an opaque error thrown from
    // whatever write happened to be first: the request proceeds without a
    // token and is refused as CSRF_TOKEN_INVALID, which the caller already
    // knows how to render.
    .catch(() => null)
    .finally(() => { csrfInFlight = null })
  return csrfInFlight
}

/** Forget the cached token. Used after the server rejects it. */
export function clearCsrfToken(): void {
  csrfToken = null
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

async function readProblem(response: Response): Promise<ProblemResponse> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes(PROBLEM_TYPE) || contentType.includes('application/json')) {
    try {
      return (await response.json()) as ProblemResponse
    } catch {
      // A refusal whose body did not parse is still a refusal. Falling through
      // to the synthetic problem below keeps the caller's error handling
      // uniform rather than making it distinguish "refused" from "refused
      // unparseably".
    }
  }
  return { type: 'about:blank', title: response.statusText || 'Fehler', status: response.status }
}

/**
 * One request.
 *
 * `cache: 'no-store'` on every call: console responses are per-principal, and
 * a stale one served to the next person at a shared staff workstation is a
 * disclosure, not a performance win. The server sends `no-store` on the gated
 * routes too; this is the client half of the same rule.
 */
export type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export async function request(
  path: string,
  { method = 'GET', body, signal, headers = {} }: RequestOptions = {},
): Promise<unknown> {
  const unsafe = UNSAFE.has(method)
  // Multipart goes as-is, with no content-type of our own: the browser writes
  // the header itself, boundary included, and a hand-set one would lack it.
  const multipart = typeof FormData !== 'undefined' && body instanceof FormData

  const send = async () => {
    const token = unsafe ? (csrfToken ?? (await fetchCsrfToken())) : null

    return fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: {
        accept: `${PROBLEM_TYPE}, application/json`,
        ...(body === undefined || multipart ? {} : { 'content-type': 'application/json' }),
        ...(token ? { 'x-csrf-token': token } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: multipart ? (body as FormData) : JSON.stringify(body) }),
    })
  }

  let response = await send()

  /**
   * One retry, and only for a stale CSRF token.
   *
   * The secret is rotated whenever a new one is minted, so a token cached from
   * before a sign-in — or from another tab that fetched one — is refused. That
   * is a mechanical staleness the user cannot act on and should never see, so
   * it is fixed here rather than surfaced.
   *
   * Exactly once: a second failure means something real is wrong, and retrying
   * a write in a loop is how a double submit becomes a double booking.
   */
  if (response.status === 403 && unsafe) {
    const problem = await readProblem(response.clone())
    if (problem?.type === PROBLEMS.CSRF_TOKEN_INVALID.type) {
      clearCsrfToken()
      await fetchCsrfToken()
      response = await send()
    }
  }

  if (!response.ok) throw new ApiError(await readProblem(response), response)

  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

type BodylessOptions = Omit<RequestOptions, 'method' | 'body'>
type BodyOptions = Omit<RequestOptions, 'method' | 'body'>

export const get = (path: string, options?: BodylessOptions) => request(path, { ...options, method: 'GET' })
export const post = (path: string, body?: unknown, options?: BodyOptions) => request(path, { ...options, method: 'POST', body })
export const patch = (path: string, body?: unknown, options?: BodyOptions) => request(path, { ...options, method: 'PATCH', body })
export const put = (path: string, body?: unknown, options?: BodyOptions) => request(path, { ...options, method: 'PUT', body })
export const del = (path: string, options?: BodylessOptions) => request(path, { ...options, method: 'DELETE' })

/**
 * The push notification endpoints (feature 011), typed from `@gwc/contracts/push`.
 *
 * A send answers 202 when it queued a notification and 200 when the same
 * `clientRef` was already accepted; the console treats both as accepted.
 * Nothing is delivered inside the request — the history shows it happen.
 */
export const pushApi = {
  testRecipients: () => get('/push/test-recipients') as Promise<TestRecipientList>,
  addTestRecipient: (body: TestRecipientAdd) => post('/push/test-recipients', body) as Promise<{ memberId: string }>,
  removeTestRecipient: (memberId: string) => del(`/push/test-recipients/${memberId}`) as Promise<{ id: string; deleted: true }>,
  audience: (kind: AudienceKind) => get(`/push/audience?kind=${kind}`) as Promise<PushAudience>,
  rehearse: (body: CampaignRequestInput) => post('/push/campaigns/preview', body) as Promise<Notification>,
  broadcast: (body: CampaignRequestInput) => post('/push/campaigns', body) as Promise<Notification>,
  history: (kind?: NotificationKind) =>
    get(`/push/campaigns${kind ? `?kind=${kind}` : ''}`) as Promise<NotificationList>,
  notification: (id: string) => get(`/push/campaigns/${id}`) as Promise<Notification>,
}
