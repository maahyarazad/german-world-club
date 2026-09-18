import fp from 'fastify-plugin'
import jwt from '@fastify/jwt'
import { COOKIES, ACCESS_TOKEN_TTL_SECONDS } from '@gwc/contracts/auth'
import { loadKeys, buildClaims } from '../modules/auth/tokens.ts'

/**
 * Token verification, one path for both faces (FR-002, FR-003).
 *
 * A browser presents the access token as the `gwc_at` cookie; the mobile app
 * presents it as `Authorization: Bearer`. §6.2 makes the *transport* differ per
 * face, but the verification is the same code — if it were two paths, they
 * would diverge, and the one used less would be the one with the bug.
 *
 * `aud` is verified here, before any handler runs, which is what makes FR-003
 * structural rather than a check each route has to remember.
 */
export default fp(
  async function jwtPlugin(app, opts) {
    const env = opts.env ?? app.env
    // Validates shape and algorithm at boot: a malformed key should stop the
    // process, not fail one member's sign-in at 2 a.m. The PEM strings
    // themselves are what fast-jwt wants — it does not accept a KeyObject.
    const keys = loadKeys(env)

    if (!keys.private || !keys.public) {
      // Production already refused to boot without keys (config/env.js). In
      // development this is a loud warning rather than a crash, so the public
      // surface can be worked on before anyone generates a keypair.
      app.log.warn('JWT keys unset — authenticated routes cannot issue or verify tokens')
    }

    await app.register(jwt, {
      secret: {
        private: env.JWT_PRIVATE_KEY ?? 'development-key-unset',
        public: env.JWT_PUBLIC_KEY ?? 'development-key-unset',
      },
      sign: { algorithm: 'EdDSA' },
      verify: {
        algorithms: ['EdDSA'],
        // A slightly-off client clock must not lock someone out of a token that
        // only lives ten minutes.
        clockTolerance: 30,
      },
      cookie: { cookieName: COOKIES.access, signed: false },
      decode: { complete: false },
    })

    /** Mint an access token for a session. Claims come from one place. */
    app.decorate('mintAccessToken', ({ accountId, sessionId, audience, now = Date.now() }) => {
      const claims = buildClaims({ accountId, sessionId, audience, now })
      return {
        token: app.jwt.sign(claims, { algorithm: 'EdDSA' }),
        claims,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      }
    })

    /**
     * Verify and check the audience.
     *
     * The audience check is *here* rather than in `@fastify/jwt`'s `aud`
     * option because the expected value depends on the route being called, and
     * a member token reaching a staff route must fail at verification rather
     * than inside a handler.
     */
    app.decorate('verifyAccessToken', async (request, expectedAudience) => {
      const claims = await request.jwtVerify()
      if (claims.typ !== 'access') throw new Error('not an access token')
      if (expectedAudience && claims.aud !== expectedAudience) {
        const err = new Error('audience mismatch')
        err.code = 'FST_JWT_BAD_AUDIENCE'
        throw err
      }
      return claims
    })
  },
  { name: 'jwt' },
)
