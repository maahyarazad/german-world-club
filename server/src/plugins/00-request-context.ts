import fp from 'fastify-plugin'
import { fastifyRequestContext } from '@fastify/request-context'
import { CLIENT_REQUEST_ID } from '@gwc/contracts/request-id'
import type { IncomingMessage } from 'node:http'
import type { FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify'

// Fastify does not export the factory type from its root; derive it.
type ChildLoggerFactory = NonNullable<FastifyServerOptions['childLoggerFactory']>
import type { GwcApp } from '../app.ts'

/**
 * Request correlation (FR-047; feature 012, research R10).
 *
 * Every request's id is a ULID **the server generates**, always. ULIDs sort by
 * creation time, which makes a log scan over a time window cheap. The id is
 * echoed as X-Request-Id, attached to every log line, included in every error
 * envelope, written to audit_log and to server_faults, and carried into
 * non-request code through the request context.
 *
 * A client-supplied X-Request-Id is never adopted as that id. It used to be,
 * when well-formed — which let any client repeat an id, pick one that sorts
 * anywhere, or collide with another request's id in audit_log. It is now kept
 * as a separate *client correlation id*: echoed on X-Client-Request-Id, bound
 * into the request's log lines as `clientRequestId`, and stored on a fault
 * record. It finds the request again for support; it is never a key.
 */

const CLIENT_HEADER = 'x-request-id'
const ECHO_HEADER = 'x-client-request-id'

/** The client's correlation id if it sent a well-formed one, else null. */
export function readClientRequestId(raw: Pick<IncomingMessage, 'headers'> | undefined): string | null {
  const supplied = raw?.headers?.[CLIENT_HEADER]
  return typeof supplied === 'string' && CLIENT_REQUEST_ID.test(supplied) ? supplied : null
}

export default fp(
  async function requestContext(app: GwcApp) {
    await app.register(fastifyRequestContext, {
      defaultStoreValues: () => ({ requestId: undefined, clientRequestId: null, principal: undefined }),
    })

    app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      request.requestContext.set('requestId', request.id)
      reply.header('x-request-id', request.id)

      const clientRequestId = readClientRequestId(request.raw)
      request.requestContext.set('clientRequestId', clientRequestId)
      // Only when the client sent one: an echo on every response would be a
      // header nobody asked for, and would change every header-set comparison.
      if (clientRequestId) reply.header(ECHO_HEADER, clientRequestId)
    })
  },
  { name: 'request-context' },
)

/**
 * Passed to Fastify as `genReqId`, with `monotonicFactory()` from `ulid`.
 *
 * Deliberately takes no notice of the request: whatever the client sent, the
 * id is ours. Monotonic, so two ids minted in the same millisecond still sort
 * in the order they were issued.
 */
export function makeGenReqId(nextId: () => string) {
  return () => nextId()
}

/**
 * Passed to Fastify as `childLoggerFactory`.
 *
 * Binds `clientRequestId` into the request's logger at creation. Rebinding
 * `request.log` in a hook would be simpler and wrong: `reply.log` is captured
 * when the request is created, so Fastify's own "incoming request" and
 * "request completed" lines would go out without it.
 */
export function makeChildLoggerFactory(): ChildLoggerFactory {
  return function childLoggerFactory(logger, bindings, childOptions, rawRequest) {
    const clientRequestId = readClientRequestId(rawRequest)
    return logger.child(clientRequestId ? { ...bindings, clientRequestId } : bindings, childOptions)
  }
}
