import type { RouteHandlerMethod } from 'fastify'
import type {
  Http2SecureServer, Http2ServerRequest, Http2ServerResponse,
} from 'node:http2'

/**
 * Request and reply types bound to *this* app.
 *
 * Importing `FastifyRequest`/`FastifyReply` bare gives the http1 defaults
 * (`RawServerDefault`, `IncomingMessage`), but `buildApp` produces an
 * `Http2SecureServer`-typed instance — so a handler written against the bare
 * types is rejected with a `raw` incompatibility that names `headersDistinct`
 * and says nothing about the actual cause.
 *
 * Deriving from `GwcApp` instead means these follow the app rather than being
 * a second declaration of it.
 *
 * Every other route module in `src/modules/` still imports the bare types and
 * carries this same error; converting them is feature 007's remaining Phase 5
 * work, and this alias is what they should use.
 */
export type GwcHandler = RouteHandlerMethod<
  Http2SecureServer,
  Http2ServerRequest,
  Http2ServerResponse
>
export type GwcRequest = Parameters<GwcHandler>[0]
export type GwcReply = Parameters<GwcHandler>[1]
