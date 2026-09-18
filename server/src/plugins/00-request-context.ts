import fp from 'fastify-plugin'
import { fastifyRequestContext } from '@fastify/request-context'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { GwcApp } from '../app.ts'

/**
 * Request correlation (FR-047).
 *
 * A ULID rather than a UUID v4: ULIDs sort by creation time, which makes a log
 * scan over a time window cheap. The id is echoed as X-Request-Id, attached to
 * every log line, included in every error envelope, written to audit_log, and
 * carried into non-request code through the request context — so a log line
 * emitted inside a dependency call is still attributable.
 */

// Accept a client-supplied id only if it looks like one, and never trust it for
// anything but correlation.
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/

export default fp(
  async function requestContext(app: GwcApp) {
    await app.register(fastifyRequestContext, {
      defaultStoreValues: () => ({ requestId: undefined, principal: undefined }),
    })

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      request.requestContext.set('requestId', request.id)
      reply.header('x-request-id', request.id)
    })
  },
  { name: 'request-context' },
)

/** Passed to Fastify as `genReqId`. */
export function makeGenReqId(ulid) {
  return (req) => {
    const supplied = req.headers?.['x-request-id']
    if (typeof supplied === 'string' && SAFE_ID.test(supplied)) return supplied
    return ulid()
  }
}

export { SAFE_ID }
