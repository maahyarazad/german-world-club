import { createHash, randomBytes, createPrivateKey, createPublicKey } from 'node:crypto'
import { ulid } from 'ulid'
import {
  ACCESS_TOKEN_CLAIMS, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TTL_DAYS, accessTokenClaimsSchema,
} from '@gwc/contracts/auth'

/**
 * Token minting (FR-002, FR-006, FR-013).
 *
 * Two credentials with deliberately different properties:
 *
 *   - the **access token** is a short-lived EdDSA JWT carrying identity and
 *     nothing else, verifiable without a database read;
 *   - the **refresh token** is an opaque 256-bit random value whose SHA-256
 *     hash is the only thing stored, so a database read yields no usable
 *     credential.
 *
 * Ed25519 rather than RSA: a 64-byte signature and sub-millisecond
 * verification, on a token verified on every single request.
 */

/** Exactly the claim key set in auth-api.md. A test asserts this list. */
export { ACCESS_TOKEN_CLAIMS }

export function buildClaims({ accountId, sessionId, audience, now = Date.now() }) {
  const iat = Math.floor(now / 1000)
  const claims = {
    sub: accountId,
    sid: sessionId,
    aud: audience,
    typ: 'access',
    // ULID rather than UUID v4: sortable by time, so a log scan over a window
    // is cheap.
    jti: ulid(now),
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
  }
  // Belt and braces: the strict schema rejects any claim a future change adds
  // here, at the point it is minted rather than at the point a client reads it.
  return accessTokenClaimsSchema.parse(claims)
}

/**
 * Refresh tokens are opaque and single-use.
 *
 * 256 bits of randomness rather than a signed structure, because the server
 * must be able to *revoke* one — a self-contained token cannot be taken back,
 * and revocation is the whole mechanism behind FR-005's replay response.
 */
export function generateRefreshToken() {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, hash: hashRefreshToken(plaintext) }
}

/** The stored form. The plaintext is never written anywhere. */
export function hashRefreshToken(plaintext) {
  return createHash('sha256').update(plaintext, 'utf8').digest()
}

export function refreshExpiry(face = 'web', now = new Date()) {
  const days = REFRESH_TTL_DAYS[face] ?? REFRESH_TTL_DAYS.web
  return new Date(now.getTime() + days * 86_400_000)
}

/** Single-use, expiring password-reset tokens share the refresh token's shape. */
export function generateOpaqueToken() {
  const plaintext = randomBytes(32).toString('base64url')
  return { plaintext, hash: createHash('sha256').update(plaintext, 'utf8').digest() }
}

/**
 * Normalise the configured keys.
 *
 * Both are validated at load rather than at first sign-in: a malformed key
 * should stop the process, not fail one member's login at 2 a.m.
 */
export function loadKeys(env) {
  if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
    return { private: null, public: null }
  }
  const priv = createPrivateKey(env.JWT_PRIVATE_KEY)
  const pub = createPublicKey(env.JWT_PUBLIC_KEY)
  if (priv.asymmetricKeyType !== 'ed25519' || pub.asymmetricKeyType !== 'ed25519') {
    throw new Error('JWT keys must be Ed25519 — EdDSA is the algorithm this service signs with')
  }
  return { private: priv, public: pub }
}
