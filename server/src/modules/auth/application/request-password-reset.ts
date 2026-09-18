import { PASSWORD_RESET_TTL_SECONDS } from '@gwc/contracts/auth'
import { query } from '../../../db/query.ts'
import { generateOpaqueToken } from '../tokens.ts'
import { findAccount } from './find-account.ts'
import type { GwcApp } from '../../../app.ts'

export async function requestPasswordReset(app: GwcApp, { email, signal }) {
  const account = await findAccount(app, email, signal)
  if (account) {
    const token = generateOpaqueToken()
    await query(
      app.pg,
      `INSERT INTO password_reset_tokens (account_id, account_kind, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [account.row.id, account.kind, token.hash, PASSWORD_RESET_TTL_SECONDS],
      { signal },
    )
    await app.sendResetMail?.({ email: account.row.email, token: token.plaintext })
  }
  // Requested is reported whether or not the account exists — the same
  // non-enumeration rule as sign-in. A 404 here would be a membership oracle.
  return { requested: true }
}
