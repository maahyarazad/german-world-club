import fp from 'fastify-plugin'
import fastifyRedis from '@fastify/redis'

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
  async function redis(app, opts) {
    const { env } = opts
    if (!env.REDIS_URL) {
      app.log.warn('REDIS_URL unset — rate limits are per-process and the session denylist is unavailable')
      app.decorate('redis', null)
      app.decorate('redisHealthy', async () => ({ ok: true, skipped: 'not configured' }))
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
  },
  { name: 'redis' },
)
