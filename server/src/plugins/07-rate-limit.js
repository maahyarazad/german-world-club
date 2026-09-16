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
      errorResponseBuilder: (request, context) => ({
        type: PROBLEMS.RATE_LIMITED.type,
        title: PROBLEMS.RATE_LIMITED.title,
        status: 429,
        detail: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)}s.`,
        instance: request.url.split('?')[0],
        requestId: request.id,
      }),
      addHeaders: {
        'x-ratelimit-limit': true,
        'x-ratelimit-remaining': true,
        'x-ratelimit-reset': true,
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
      return { bucket: name, max: b.max, timeWindow: b.timeWindow, skipOnError: b.skipOnError }
    })
  },
  { name: 'rate-limit', dependencies: ['redis'] },
)
