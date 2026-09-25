import fp from 'fastify-plugin'
import { PROBLEMS } from '@gwc/contracts/errors'
import { errorPage } from '../modules/public/templates/error-page.ts'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

/**
 * One error envelope for every route (FR-049, FR-017).
 *
 * §12.15 — one rule set, three clients — extends to failures. If the web client
 * parses `{error}` and mobile parses `{message}`, error handling diverges on
 * day one, which is the drift §1.1 describes.
 *
 * `detail` never leaks internals: a failed query is "An internal error
 * occurred" plus the requestId, with the real cause in the logs only.
 */

const wantsHtml = (request: FastifyRequest) => {
  const accept = request.headers.accept ?? ''
  return accept.includes('text/html') && !request.url.startsWith('/api')
}

function problemFor(error) {
  if (error.problem) return error.problem
  if (error.validation) return PROBLEMS.VALIDATION_FAILED
  if (error.statusCode === 404) return PROBLEMS.NOT_FOUND
  if (error.statusCode === 429) return PROBLEMS.RATE_LIMITED
  if (error.statusCode === 401) return PROBLEMS.UNAUTHENTICATED
  // @fastify/csrf-protection throws a bare 403. Left as INSUFFICIENT_PERMISSION
  // it was indistinguishable from "you lack the grant", so a browser client had
  // no way to know that fetching a fresh token and retrying would work.
  if (error.code === 'FST_CSRF_MISSING_SECRET' || error.code === 'FST_CSRF_INVALID_TOKEN') {
    return PROBLEMS.CSRF_TOKEN_INVALID
  }
  if (error.statusCode === 403) return PROBLEMS.INSUFFICIENT_PERMISSION
  if (error.statusCode === 413) return PROBLEMS.MEDIA_TOO_LARGE
  if (error.statusCode === 503) return PROBLEMS.SERVICE_UNAVAILABLE
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return { type: PROBLEMS.CONFLICT.type, title: error.message || 'Request error', status: error.statusCode }
  }
  return PROBLEMS.INTERNAL
}

/** Safe `detail` — specific for client errors, generic for server faults. */
function detailFor(error, problem) {
  if (problem.status >= 500) return 'An internal error occurred.'
  if (error.validation) {
    return 'One or more fields are invalid.'
  }
  return error.safeDetail ?? error.message ?? problem.title
}

export function buildProblem(error, request: FastifyRequest) {
  const problem = problemFor(error)
  const body = {
    type: problem.type,
    title: problem.title,
    status: problem.status,
    detail: detailFor(error, problem),
    instance: request.url.split('?')[0],
    requestId: request.id,
  }
  if (error.validation) {
    body.errors = (error.validation ?? []).map((v) => ({
      path: (v.instancePath ?? '').replace(/^\//, '') || v.params?.missingProperty || '(body)',
      message: v.message ?? 'invalid',
    }))
  }
  return body
}

export default fp(
  async function errorHandler(app: GwcApp) {
    app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
      const body = buildProblem(error, request)

      if (body.status >= 500) {
        request.log.error({ err: error, requestId: request.id }, 'request failed')
      } else {
        request.log.warn({ statusCode: body.status, type: body.type }, 'request rejected')
      }

      /**
       * Feature 012: an unexpected fault is also stored, so the request id a
       * member reads out still leads somewhere once the log has scrolled away.
       *
       * INTERNAL, not `status >= 500`: every deliberate 5xx — load shedding,
       * an open breaker, a passed deadline — carries its own problem type, so
       * INTERNAL is exactly "the platform did not anticipate this". Storing the
       * deliberate ones would flood the table during the outage they describe.
       *
       * Not awaited, on purpose (FR-004): the answer below must not wait on,
       * or be changed by, the database — which is often the very thing that
       * failed. The recorder never rejects; `void` only says so.
       */
      if (body.type === PROBLEMS.INTERNAL.type) {
        // Anything can be thrown; read only these four fields, defensively.
        const failure = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown }
        void app.recordServerFault?.({
          requestId: request.id,
          clientRequestId: request.requestContext?.get('clientRequestId') ?? null,
          method: request.method,
          // The pattern, never request.url: no path values, no query string.
          route: request.routeOptions?.url ?? null,
          status: body.status,
          errorName: typeof failure.name === 'string' ? failure.name : 'Error',
          errorCode: typeof failure.code === 'string' ? failure.code : null,
          message: String(failure.message ?? ''),
          stack: typeof failure.stack === 'string' ? failure.stack : null,
          principalKind: request.principal?.kind ?? null,
          principalId: request.principal?.id ?? null,
        })
      }

      if (wantsHtml(request)) {
        return reply
          .code(body.status)
          .header('content-type', 'text/html; charset=utf-8')
          .header('x-robots-tag', 'noindex, nofollow')
          .send(errorPage({ status: body.status, title: body.title, requestId: request.id, nonce: reply.cspNonce?.style }))
      }

      return reply
        .code(body.status)
        .header('content-type', 'application/problem+json; charset=utf-8')
        .send(body)
    })

    /**
     * A real 404 (FR-017, §12.13).
     *
     * The single-page-app shell is served only at its own declared routes,
     * never as a fallback. A success response carrying fallback content creates
     * unlimited duplicate indexable URLs, which §10.6 names as a defect to
     * explicitly prevent and regression-test.
     */
    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const body = {
        type: PROBLEMS.NOT_FOUND.type,
        title: PROBLEMS.NOT_FOUND.title,
        status: 404,
        detail: 'No resource exists at this path.',
        instance: request.url.split('?')[0],
        requestId: request.id,
      }

      if (wantsHtml(request)) {
        return reply
          .code(404)
          .header('content-type', 'text/html; charset=utf-8')
          .header('x-robots-tag', 'noindex, nofollow')
          .send(errorPage({ status: 404, title: 'Page not found', requestId: request.id, nonce: reply.cspNonce?.style }))
      }

      return reply
        .code(404)
        .header('content-type', 'application/problem+json; charset=utf-8')
        .send(body)
    })
  },
  { name: 'error-handler' },
)
