import { describeProblem, isRetryable, requiresReauthentication, invalidatesCapabilities } from './problems.js'

/**
 * The one way the console talks to the API.
 *
 * The browser face authenticates by cookie — `credentials: 'include'` is the
 * whole of it — while the mobile face uses a bearer token. Constitution
 * Principle I permits the *mechanism* to differ per client; the authorization
 * *outcome* is identical because the server resolves it the same way for both.
 */

/** Thrown for any non-2xx. Carries the parsed problem, never a bare message. */
export class ApiError extends Error {
  constructor(problem, response) {
    const described = describeProblem(problem)
    super(described.title)
    this.name = 'ApiError'
    this.problem = problem
    this.status = response?.status ?? problem?.status ?? 0
    this.described = described
    /** Seconds to wait, from `retry-after`. Null when the server did not say. */
    this.retryAfter = readRetryAfter(response)
  }

  get retryable() {
    return isRetryable(this.problem)
  }

  get needsSignIn() {
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
  get capabilitiesStale() {
    return invalidatesCapabilities(this.problem)
  }
}

function readRetryAfter(response) {
  const header = response?.headers?.get?.('retry-after')
  if (!header) return null
  const seconds = Number(header)
  return Number.isFinite(seconds) ? seconds : null
}

const PROBLEM_TYPE = 'application/problem+json'

async function readProblem(response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes(PROBLEM_TYPE) || contentType.includes('application/json')) {
    try {
      return await response.json()
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
export async function request(path, { method = 'GET', body, signal, headers = {} } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    signal,
    headers: {
      accept: `${PROBLEM_TYPE}, application/json`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  if (!response.ok) throw new ApiError(await readProblem(response), response)

  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

export const get = (path, options) => request(path, { ...options, method: 'GET' })
export const post = (path, body, options) => request(path, { ...options, method: 'POST', body })
export const patch = (path, body, options) => request(path, { ...options, method: 'PATCH', body })
export const put = (path, body, options) => request(path, { ...options, method: 'PUT', body })
export const del = (path, options) => request(path, { ...options, method: 'DELETE' })
