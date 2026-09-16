import fp from 'fastify-plugin'
import rateLimit from '@fastify/rate-limit'
import { BUCKETS, CRAWLER_ALLOWLIST, assertBuckets } from '../config/rate-limits.js'
import { PROBLEMS } from '@gwc/contracts/errors'

/**
 * Rate-limit mechanism. Individual buckets are attached per route by the story
 * that owns them (credential buckets in US1, `public-read` in US2, the rest in
 * US4), via `config.rateLimit: 'bucket-name'`.
 *
 * `trustProxy` is configured on the Fastify instance, not here, but it is what
 * makes the `ip` dimension mean anything: behind a proxy every request arrives
 * from the proxy's address, so a naive per-address limit treats the whole
 * internet as one client.
 */

/** Resolve the key for a bucket's dimension. */
export function keyForBucket(bucketName, request) {
  const bucket = BUCKETS[bucketName]
  const scope = `${bucketName}:`
  switch (bucket?.dimension) {
    case 'ip':
      return scope + request.ip
    case 'account':
      return scope + (request.principal?.id ?? request.body?.email ?? request.ip)
    case 'phone':
      return scope + (request.body?.mobile ?? request.principal?.id ?? request.ip)
    case 'challenge':
      return scope + (request.body?.challengeId ?? request.ip)
    case 'session':
      return scope + (request.principal?.sid ?? request.ip)
    default:
      return scope + request.ip
  }
}

/**
 * Which lifecycle hook a bucket's limiter must run on.
 *
 * Only the `ip` dimension can be keyed at `onRequest`: the address is known
 * from the socket. Every other dimension reads something that does not exist
 * that early — `request.principal` is set by the authentication hook, and
 * `request.body` has not been parsed — so an account-dimension bucket evaluated
 * at `onRequest` silently falls back to the address and stops being an account
 * limit at all. Behind a corporate NAT or a mobile carrier that means every
 * member shares one bucket, and a per-account ceiling that reads as enforced is
 * not enforced.
 *
 * The cost is that an unauthenticated flood on those routes is refused slightly
 * later, after body parsing. That is the right trade: the routes carrying these
 * buckets are already authenticated ones, and a limit that does not measure
 * what it claims to measure is worse than a slightly more expensive refusal.
 * Credential endpoints keep an `ip` bucket at `onRequest` as well, so the cheap
 * refusal still exists where an unauthenticated flood is actually expected.
 */
export const hookFor = (dimension) => (dimension === 'ip' ? 'onRequest' : 'preHandler')

/** A verified crawler is never throttled (FR-041, SC-014). */
export function isAllowlistedCrawler(request) {
  const ua = request.headers['user-agent'] ?? ''
  return CRAWLER_ALLOWLIST.some((c) => ua.includes(c))
}

export default fp(
  async function rateLimitPlugin(app, opts) {
    assertBuckets()

    const redis = app.redis ?? null
    if (!redis && opts.env?.isProduction) {
      throw new Error(
        'Rate limiting requires Redis in production: an in-memory store grants N× every limit ' +
          'across N instances.',
      )
    }

    await app.register(rateLimit, {
      global: false,
      redis,
      // Never throttle a verified crawler — see FR-041.
      allowList: (request) => isAllowlistedCrawler(request),
      keyGenerator: (request) => keyForBucket(request.routeOptions?.config?.rateLimit?.bucket, request),
      /**
       * @fastify/rate-limit *throws* whatever this returns, so the value has to
       * be an error our own handler recognises — a bare problem+json object has
       * no `statusCode`, and 14-error-handler.js would classify it as an
       * internal fault and answer 429-as-500.
       *
       * `context.statusCode` rather than a hardcoded 429: the plugin uses 403
       * when a key crosses the ban threshold, and reporting that as 429 would
       * tell a banned client to simply retry later.
       */
      errorResponseBuilder: (request, context) => {
        const retryAfterSeconds = Math.ceil(context.ttl / 1000)
        const error = new Error(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`)
        error.statusCode = context.statusCode
        error.problem = context.ban
          ? { ...PROBLEMS.RATE_LIMITED, title: 'Temporarily banned', status: context.statusCode }
          : PROBLEMS.RATE_LIMITED
        error.safeDetail = error.message
        return error
      },
      /**
       * These keys are matched against the *draft-spec* header names because
       * `enableDraftSpec` is on. Spelling them `x-ratelimit-*` here silently
       * emits no headers at all, which FR-042 requires.
       */
      addHeaders: {
        'ratelimit-limit': true,
        'ratelimit-remaining': true,
        'ratelimit-reset': true,
        'retry-after': true,
      },
      enableDraftSpec: true,
    })

    /**
     * Per-route bucket options, for use as
     * `config: { auth, budget, rateLimit: app.bucket('sign-in-ip') }`.
     *
     * The bucket's name travels with the options so the shared `keyGenerator`
     * can pick the right dimension — a route declares *which* bucket, never
     * how the key is built, so one bucket cannot be keyed two ways.
     */
    app.decorate('bucket', (name) => {
      const b = BUCKETS[name]
      if (!b) throw new Error(`Unknown rate-limit bucket: ${name}`)
      return {
        bucket: name,
        max: b.max,
        timeWindow: b.timeWindow,
        skipOnError: b.skipOnError,
        hook: hookFor(b.dimension),
      }
    })

    /**
     * A limiter that counts even when another limiter already ran (SC-013).
     *
     * @fastify/rate-limit marks each request with a private "already ran"
     * symbol and every limiter derived from one registration shares it, so the
     * *second* bucket on a route silently returns without counting. For most
     * routes that guard is a convenience. On sign-in it is a security defect:
     * the spec requires the per-address AND the per-account bucket to be
     * checked, because either alone leaves a real attack open — per-address is
     * defeated by a botnet, per-account lets one host enumerate the member base
     * and lock any member out at will.
     *
     * Clearing the marker before delegating restores the declared behaviour.
     * The symbol is found by its description rather than reached for through
     * plugin internals, and a miss is non-fatal: the limiter still runs, it
     * just reverts to the library's once-per-request behaviour.
     */
    const RAN_MARKER = 'fastify.request.rateLimitRan'
    app.decorate('rateLimitIndependent', (options) => {
      const limiter = app.rateLimit(options)
      return async function independentRateLimit(request, reply) {
        for (const marker of Object.getOwnPropertySymbols(request)) {
          if (marker.description === RAN_MARKER) request[marker] = false
        }
        return limiter(request, reply)
      }
    })
  },
  { name: 'rate-limit', dependencies: ['redis'] },
)
