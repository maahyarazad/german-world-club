import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { buildAuthApp } from '../helpers/auth.js'
import { buildClaims } from '../../src/auth/tokens.js'
import { ACCESS_TOKEN_CLAIMS, ACCESS_TOKEN_TTL_SECONDS, accessTokenClaimsSchema } from '@gwc/contracts/auth'

/**
 * FR-006 / FR-013 — the access token carries identity and nothing else.
 *
 * This is the test the whole authorization design leans on. Permissions are
 * resolved server-side per request precisely so that a revocation bites on the
 * next request (SC-003); the moment a permission flag is baked into a
 * ten-minute token, that guarantee becomes a ten-minute promise.
 *
 * So a well-meaning addition to the claim set fails **here**, in CI, rather
 * than silently becoming something a client starts relying on.
 */
let app
beforeAll(async () => { app = await buildAuthApp() })
afterAll(async () => { await app.close() })

const claimsFor = (audience = 'member') =>
  buildClaims({ accountId: randomUUID(), sessionId: randomUUID(), audience })

describe('access-token claims (FR-006, FR-013)', () => {
  it('is EXACTLY sub, sid, aud, typ, jti, iat, exp — no more, no fewer', () => {
    expect(Object.keys(claimsFor()).sort()).toEqual([...ACCESS_TOKEN_CLAIMS].sort())
  })

  it('carries no permissions, no role matrix, no membership tier, no contact detail', () => {
    const claims = claimsFor('admin')
    for (const forbidden of [
      'permissions', 'modules', 'roles', 'role', 'isAdmin', 'isSuperadmin',
      'membership', 'package', 'tier', 'entitlement', 'discount',
      'email', 'name', 'displayName', 'mobile',
    ]) {
      expect(claims, `claim "${forbidden}" must not exist`).not.toHaveProperty(forbidden)
    }
  })

  it('rejects an added claim at minting time, not at reading time', () => {
    expect(() => accessTokenClaimsSchema.parse({ ...claimsFor(), isSuperadmin: true })).toThrow()
  })

  it('states the audience, which is what makes FR-003 structural', () => {
    expect(claimsFor('member').aud).toBe('member')
    expect(claimsFor('admin').aud).toBe('admin')
  })

  it('lives exactly ten minutes', () => {
    const claims = claimsFor()
    expect(claims.exp - claims.iat).toBe(ACCESS_TOKEN_TTL_SECONDS)
  })

  it('uses a sortable jti, so a log scan over a window is cheap', () => {
    const a = claimsFor().jti
    const b = claimsFor().jti
    expect(a).not.toBe(b)
    // ULIDs are 26 characters of Crockford base32 and sort lexicographically
    // by time — a UUID v4 would not.
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect([a, b].sort()[0]).toBe(a <= b ? a : b)
  })

  it('survives a round trip through the signer unchanged', async () => {
    const accountId = randomUUID()
    const sessionId = randomUUID()
    const { token, claims } = app.mintAccessToken({ accountId, sessionId, audience: 'member' })
    const decoded = app.jwt.decode(token)
    // The signer adds nothing of its own — `aud` stays a plain string and no
    // `iss` or `nbf` appears that the contract does not name.
    expect(Object.keys(decoded).sort()).toEqual([...ACCESS_TOKEN_CLAIMS].sort())
    expect(decoded.sub).toBe(accountId)
    expect(decoded.sid).toBe(sessionId)
    expect(decoded.jti).toBe(claims.jti)
  })

  it('signs with EdDSA — a 64-byte signature verified on every request', async () => {
    const { token } = app.mintAccessToken({ accountId: randomUUID(), sessionId: randomUUID(), audience: 'admin' })
    const header = JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())
    expect(header.alg).toBe('EdDSA')
  })

  it('refuses a token signed by a different key', async () => {
    const { token } = app.mintAccessToken({ accountId: randomUUID(), sessionId: randomUUID(), audience: 'member' })
    const [h, p] = token.split('.')
    const forged = `${h}.${p}.${'A'.repeat(86)}`
    expect(() => app.jwt.verify(forged)).toThrow()
  })
})
