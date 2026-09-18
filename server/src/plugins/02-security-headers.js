import fp from 'fastify-plugin'
import helmet from '@fastify/helmet'
import { postureFor } from '../seo/surfaces.js'

/**
 * Security headers, and the crawl-directive half of FR-025.
 *
 * §10.1 requires gated surfaces to be excluded from indexing by a crawl
 * directive *in addition to* access control, "because URL shapes leak through
 * referrers and shared links" — so the X-Robots-Tag below is not redundant
 * with the 401.
 *
 * `no-store` on gated responses is likewise a correctness requirement, not a
 * performance tweak: a member profile cached by a shared proxy and served to a
 * later visitor is a PII breach.
 *
 * CSP nonces come from helmet's own `enableCSPNonces`, which decorates
 * `reply.cspNonce`. Hand-rolling them does not work: helmet's directive
 * functions are called with the *raw* Node request, not the Fastify one.
 */
export default fp(
  async function securityHeaders(app) {
    await app.register(helmet, {
      global: true,
      enableCSPNonces: true,
      contentSecurityPolicy: {
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    })

    app.addHook('onSend', async (request, reply, payload) => {
      const posture = postureFor(request.routeOptions?.config?.auth, request.url)
      if (!posture.indexed) reply.header('x-robots-tag', 'noindex, nofollow')
      if (!posture.public) reply.header('cache-control', 'private, no-store')
      return payload
    })
  },
  { name: 'security-headers', dependencies: ['request-context'] },
)
