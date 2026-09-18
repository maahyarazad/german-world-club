import { hashPassword } from '../modules/auth/passwords.js'

/**
 * One argon2id hash per distinct password, reused across every account that
 * shares it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A single hash costs ~57 ms at the configured cost (argon2id, 19 MiB, t=2).
 * Five hundred accounts hashed individually is roughly 28 seconds of pure CPU
 * on every run — enough that people stop running the seed, and a seed nobody
 * runs is worse than no seed.
 *
 * An argon2 hash is self-contained: the PHC string carries its own salt and
 * parameters. Reusing one across many rows means those accounts genuinely share
 * one password, which is exactly what a published demo credential is. Nothing
 * is weakened, because there was nothing to weaken — the password is printed on
 * the terminal.
 *
 * ── The shortcut not taken ──────────────────────────────────────────────────
 * It would be faster still to drop the cost parameters for seeding. That is
 * refused: sign-in latency under seeded data would then stop resembling
 * production, and the one place a deliberately slow hash actually matters
 * becomes the one place nobody measures it.
 */
const cache = new Map()

export async function hashFor(password) {
  let hash = cache.get(password)
  if (!hash) {
    hash = await hashPassword(password)
    cache.set(password, hash)
  }
  return hash
}

/** Hash a whole set up front, so the cost is paid once and visibly. */
export async function hashAll(passwords) {
  const unique = [...new Set(passwords)]
  await Promise.all(unique.map((p) => hashFor(p)))
  return unique.length
}

/**
 * A legacy unsalted MD5 digest, as the pre-migration store held them.
 *
 * Never verified against — `credentialState()` treats a 32-character hex string
 * as already public and routes the account to a password reset (FR-014). Seeded
 * so that path has an account behind it rather than being hypothetical.
 */
export const LEGACY_MD5_HASH = '5f4dcc3b5aa765d61d8327deb882cf99'

export const hashCacheSize = () => cache.size
