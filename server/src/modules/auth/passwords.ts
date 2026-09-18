import argon2 from 'argon2'

/**
 * Password hashing and verification (FR-014).
 *
 * argon2id at the OWASP baseline: 19 MiB of memory, 2 iterations, parallelism
 * 1. The memory cost is the point — it is what makes a GPU array a poor tool
 * against these hashes, and it is also why the auth route class gets a 5 s
 * budget rather than the 2 s a member read gets.
 */

export const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB, the OWASP baseline
  timeCost: 2,
  parallelism: 1,
})

export async function hashPassword(plaintext) {
  return argon2.hash(plaintext, ARGON2_OPTIONS)
}

/**
 * A hash of a value nobody knows, verified against when the account does not
 * exist — so a missing account costs the same time as a wrong password.
 *
 * Built lazily and once. Without it, an unknown address answers in
 * microseconds and a known one in tens of milliseconds, which enumerates the
 * member base of an invite-only club by stopwatch (§3.1).
 */
let dummyHashPromise = null
export function dummyHash() {
  dummyHashPromise ??= argon2.hash('gwc-dummy-verification-target', ARGON2_OPTIONS)
  return dummyHashPromise
}

/**
 * Counts how many times the dummy path actually ran.
 *
 * `non-enumeration.test.js` asserts against this counter rather than against
 * elapsed wall-clock time, which is far too flaky for CI. The timing claim is
 * recorded as a separate benchmark with a stated tolerance.
 */
export const stats = { dummyVerifications: 0, realVerifications: 0 }

/** Verify against a real stored hash. */
export async function verifyPassword(storedHash, plaintext) {
  stats.realVerifications += 1
  try {
    return await argon2.verify(storedHash, plaintext)
  } catch {
    // A malformed or unrecognised hash is a failed verification, never a 500.
    return false
  }
}

/** Burn equivalent time for an account that does not exist. Always false. */
export async function verifyAgainstDummy(plaintext) {
  stats.dummyVerifications += 1
  try {
    await argon2.verify(await dummyHash(), plaintext)
  } catch {
    // Expected: the point is the work, not the answer.
  }
  return false
}

/**
 * The credential outcomes an account's stored state allows, before the
 * password is even considered.
 *
 * FR-014: an unsalted MD5 value from the legacy system is treated as **already
 * public** and is never verified. There is no migration path that accepts one
 * "just this once" — the account resets instead. The same applies to a NULL
 * hash and to an explicit `password_reset_required` flag.
 */
export const CREDENTIAL_STATE = Object.freeze({
  USABLE: 'usable',
  RESET_REQUIRED: 'password_reset_required',
})

/** A 32-character hex string is an unsalted MD5 digest from the legacy store. */
export const looksLikeLegacyMd5 = (hash) => typeof hash === 'string' && /^[0-9a-f]{32}$/i.test(hash.trim())

export function credentialState(account) {
  if (!account) return CREDENTIAL_STATE.USABLE
  if (account.password_reset_required) return CREDENTIAL_STATE.RESET_REQUIRED
  if (account.password_hash == null || account.password_hash === '') return CREDENTIAL_STATE.RESET_REQUIRED
  if (looksLikeLegacyMd5(account.password_hash)) return CREDENTIAL_STATE.RESET_REQUIRED
  // argon2 hashes are PHC-encoded and start with $argon2. Anything else is not
  // something this codebase produced, so it is not something it will trust.
  if (!account.password_hash.startsWith('$argon2')) return CREDENTIAL_STATE.RESET_REQUIRED
  return CREDENTIAL_STATE.USABLE
}
