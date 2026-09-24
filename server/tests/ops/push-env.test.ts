import { describe, it, expect } from 'vitest'
import { loadEnv } from '../../src/config/env.ts'

/**
 * Push credentials refuse to boot rather than degrade (feature 011, research
 * R8, FR-030; quickstart row 16).
 */

const base = {
  DATABASE_URL: 'postgres://localhost/x',
  CANONICAL_ORIGIN: 'https://example.test',
  TRUST_PROXY: '1',
  REDIS_ENABLED: 'true',
  REDIS_URL: 'redis://localhost',
  JWT_PRIVATE_KEY: 'k',
  JWT_PUBLIC_KEY: 'k',
}
const fcm = { FCM_PROJECT_ID: 'gwc', FCM_CLIENT_EMAIL: 'push@gwc.iam', FCM_PRIVATE_KEY: '-----BEGIN…' }

describe('push environment', () => {
  it('refuses production without EXPO_ACCESS_TOKEN, naming the variable', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/EXPO_ACCESS_TOKEN/)
  })

  it('boots production with it', () => {
    // Counter-assertion: the refusal above is about the token, not about
    // production being unbootable.
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', EXPO_ACCESS_TOKEN: 'expo-token' })).not.toThrow()
  })

  it('does not require it in development', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow()
  })

  it.each([
    [{ FCM_PROJECT_ID: fcm.FCM_PROJECT_ID }, /FCM_CLIENT_EMAIL[\s\S]*FCM_PRIVATE_KEY|FCM_PRIVATE_KEY[\s\S]*FCM_CLIENT_EMAIL/],
    [{ FCM_PROJECT_ID: fcm.FCM_PROJECT_ID, FCM_CLIENT_EMAIL: fcm.FCM_CLIENT_EMAIL }, /FCM_PRIVATE_KEY/],
    [{ FCM_PRIVATE_KEY: fcm.FCM_PRIVATE_KEY }, /FCM_PROJECT_ID/],
  ])('refuses a partial FCM set in any environment (%o)', (partial, names) => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', ...partial })).toThrow(names)
    expect(() => loadEnv({ ...base, NODE_ENV: 'test', ...partial })).toThrow(/all three or none/)
  })

  it('boots with all of FCM or none of it', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', ...fcm })).not.toThrow()
    expect(() => loadEnv({ ...base, NODE_ENV: 'development' })).not.toThrow()
    // Empty strings are "unset", as a blank line in .env means.
    expect(() => loadEnv({ ...base, NODE_ENV: 'development', FCM_PROJECT_ID: '', FCM_CLIENT_EMAIL: '' })).not.toThrow()
  })
})
