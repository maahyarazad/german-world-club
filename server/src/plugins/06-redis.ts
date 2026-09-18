import fp from 'fastify-plugin'
import fastifyRedis from '@fastify/redis'
import type { GwcApp } from '../app.ts'

/**
 * Redis: rate-limit buckets and the session revocation denylist.
 *
 * Its own failure behaviour is decided per rate-limit bucket (FR-044), not
 * here — permissive for public reads, restrictive on credential paths. In
 * development a single process makes per-instance limits equivalent to
 * distributed ones; in a deployed environment they are NOT, which is why
 * REDIS_URL is required in production.
 */
export default fp(
  async function redis(app: GwcApp, opts) {
    const { env } = opts
    if (!env.REDIS_URL) {
      app.log.warn('REDIS_URL unset — rate limits are per-process and the session denylist is unavailable')
      app.decorate('redis', null)
      app.decorate('redisHealthy', async () => ({ ok: true, skipped: 'not configured' }))
      // Same shape whether Redis is configured or not, so no caller has to ask.
      app.decorate('withRedis', async (_fn, fallback) =>
        typeof fallback === 'function' ? fallback() : fallback,
      )
      return
    }

    await app.register(fastifyRedis, {
      url: env.REDIS_URL,
      closeClient: true,
      connectTimeout: 250,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    })

    app.decorate('redisHealthy', async () => {
      try {
        await app.redis.ping()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    })

    /**
     * Redis behind its own 250 ms breaker.
     *
     * The limiter's own dependency must not become the outage. Without this, a
     * Redis that accepts connections and then stalls makes *every* request wait
     * out the limiter's lookup before doing any real work — so a cache used to
     * protect the server becomes the thing slowing it down. 250 ms is a
     * generous ceiling for an in-memory store on the same network; anything
     * slower is a failure, not a slow success.
     *
     * The breaker plugin loads after this one, so the wrapper resolves it
     * lazily. Callers that run before it is available fall through to a direct
     * call, which is the current behaviour and no worse.
     */
    app.decorate('withRedis', async (fn, fallback) => {
      const breaker = app.breakers?.redis
      if (!breaker) return fn(app.redis)
      try {
        return await breaker.run(() => fn(app.redis), { fallback })
      } catch (err) {
        app.log.warn({ err }, 'redis unavailable')
        // Per-bucket `skipOnError` decides what a *limiter* does about this
        // (FR-044); this only reports that the call did not happen.
        if (fallback !== undefined) return typeof fallback === 'function' ? fallback(err) : fallback
        throw err
      }
    })
  },
  { name: 'redis' },
)
