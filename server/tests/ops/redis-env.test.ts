import { describe, it, expect } from 'vitest'
import { loadEnv } from '../../src/config/env.ts'
import { buildApp } from '../../src/app.ts'
import { hasDatabase } from '../helpers/db.ts'

/**
 * REDIS_ENABLED gates the Redis client, not the redis plugin: the plugin stays
 * registered so its dependants boot, and only the connection is skipped.
 */

const base = { DATABASE_URL: 'postgres://localhost/x' }
const production = {
  ...base,
  NODE_ENV: 'production',
  CANONICAL_ORIGIN: 'https://example.test',
  TRUST_PROXY: '1',
  REDIS_URL: 'redis://localhost',
  JWT_PRIVATE_KEY: 'k',
  JWT_PUBLIC_KEY: 'k',
  EXPO_ACCESS_TOKEN: 'expo-token',
}

describe('REDIS_ENABLED', () => {
  it('defaults to false, even with REDIS_URL set', () => {
    expect(loadEnv({ ...base, REDIS_URL: 'redis://localhost' }).REDIS_ENABLED).toBe(false)
  })

  it('refuses true without a REDIS_URL, naming the variable', () => {
    expect(() => loadEnv({ ...base, REDIS_ENABLED: 'true' })).toThrow(/REDIS_URL/)
  })

  it('refuses production with Redis disabled', () => {
    expect(() => loadEnv(production)).toThrow(/REDIS_ENABLED/)
    // Counter-assertion: the refusal is about the flag, not production itself.
    expect(() => loadEnv({ ...production, REDIS_ENABLED: 'true' })).not.toThrow()
  })

  // buildApp connects to Postgres, so this one needs a database like the rest.
  it.skipIf(!hasDatabase)('boots with no client when disabled, though REDIS_URL points nowhere', async () => {
    // Port 1 accepts no connection, so a registered client would fail readiness.
    const env = { ...loadEnv(), REDIS_ENABLED: false, REDIS_URL: 'redis://127.0.0.1:1' }
    const app = await buildApp({ env })
    await app.ready()
    try {
      expect(app.redis).toBeNull()
      expect(await app.redisHealthy()).toEqual({ ok: true, skipped: 'disabled' })
    } finally {
      await app.close()
    }
  })
})
