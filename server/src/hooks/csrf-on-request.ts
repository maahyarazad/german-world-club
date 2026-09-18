import { COOKIES } from '@gwc/contracts/auth'

/**
 * Checked at onRequest, before authentication: a forged request should be
 * refused before the server spends a session lookup on it, and the answer to
 * a cross-site POST must not depend on whether the stolen cookie is still
 * valid. The token travels in `x-csrf-token`, which is what makes the check
 * possible this early — the body has not been parsed yet.
 *
 * Registered after `@fastify/cookie` and `@fastify/csrf-protection`, which is
 * what supplies `app.csrfProtection`.
 */
export function registerCsrfHook(app) {
  app.addHook('onRequest', async (request, reply) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
    const cookieBorne = Boolean(request.cookies?.[COOKIES.access] ?? request.cookies?.[COOKIES.refresh])
    const bearer = String(request.headers.authorization ?? '').startsWith('Bearer ')
    if (unsafe && cookieBorne && !bearer) {
      await new Promise((resolve, reject) => {
        app.csrfProtection(request, reply, (err) => (err ? reject(err) : resolve()))
      })
    }
  })
}
