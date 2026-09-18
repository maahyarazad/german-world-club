import { describe, it, expect } from 'vitest'
import argon2 from 'argon2'
import {
  hashPassword, verifyPassword, verifyAgainstDummy, dummyHash, stats,
  credentialState, looksLikeLegacyMd5, CREDENTIAL_STATE, ARGON2_OPTIONS,
} from '../../src/modules/auth/passwords.ts'

/**
 * FR-014 — credential handling.
 *
 * The load-bearing decision: an unsalted MD5 value imported from the legacy
 * system is treated as **already public** and is never verified. There is no
 * "just this once" path. The account resets, which is the only honest response
 * to a credential store that should be assumed readable.
 */

describe('argon2id hashing', () => {
  it('hashes at the OWASP baseline — 19 MiB, 2 iterations, parallelism 1', () => {
    expect(ARGON2_OPTIONS.memoryCost).toBe(19456)
    expect(ARGON2_OPTIONS.timeCost).toBe(2)
    expect(ARGON2_OPTIONS.parallelism).toBe(1)
    expect(ARGON2_OPTIONS.type).toBe(argon2.argon2id)
  })

  it('produces a PHC-encoded argon2id hash', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('salts, so the same password hashes differently every time', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')])
    expect(a).not.toBe(b)
  })

  it('verifies the right password and refuses the wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery')
    expect(await verifyPassword(hash, 'correct-horse-battery')).toBe(true)
    expect(await verifyPassword(hash, 'Correct-horse-battery')).toBe(false)
  })

  it('treats a malformed stored hash as a failed verification, never a 500', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword(null, 'anything')).toBe(false)
  })
})

describe('legacy MD5 is never accepted (FR-014)', () => {
  it('recognises an unsalted MD5 digest', () => {
    expect(looksLikeLegacyMd5('5f4dcc3b5aa765d61d8327deb882cf99')).toBe(true)
    expect(looksLikeLegacyMd5('$argon2id$v=19$m=19456,t=2,p=1$abc$def')).toBe(false)
  })

  it('routes an MD5-hashed account to a reset instead of verifying it', () => {
    // The digest below is md5("password") — the single most common one in any
    // leaked legacy store.
    const account = { password_hash: '5f4dcc3b5aa765d61d8327deb882cf99', password_reset_required: false }
    expect(credentialState(account)).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
  })

  it('routes a NULL hash to a reset', () => {
    expect(credentialState({ password_hash: null })).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
    expect(credentialState({ password_hash: '' })).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
  })

  it('honours an explicit password_reset_required flag over a usable hash', async () => {
    const account = { password_hash: await hashPassword('x'), password_reset_required: true }
    expect(credentialState(account)).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
  })

  it('refuses any hash this codebase did not produce', () => {
    expect(credentialState({ password_hash: '$2b$12$abcdefghijklmnopqrstuv' })).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
    expect(credentialState({ password_hash: 'sha1:deadbeef' })).toBe(CREDENTIAL_STATE.RESET_REQUIRED)
  })

  it('accepts a real argon2id hash', async () => {
    expect(credentialState({ password_hash: await hashPassword('x'), password_reset_required: false }))
      .toBe(CREDENTIAL_STATE.USABLE)
  })
})

describe('the dummy verification path', () => {
  it('exists, is a real argon2 hash, and is built once', async () => {
    const first = await dummyHash()
    const second = await dummyHash()
    expect(first.startsWith('$argon2id$')).toBe(true)
    expect(first).toBe(second)
  })

  it('always answers false and counts itself, so a test can assert it ran', async () => {
    const before = stats.dummyVerifications
    expect(await verifyAgainstDummy('anything at all')).toBe(false)
    expect(stats.dummyVerifications).toBe(before + 1)
  })
})
