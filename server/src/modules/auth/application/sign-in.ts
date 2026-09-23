import { PROBLEMS } from '@gwc/contracts/errors'
import { OTP_TTL_SECONDS } from '@gwc/contracts/auth'
import { query } from '../../../db/query.ts'
import { forbidden } from '../../../authz/require-permission.ts'
import { verifyPassword, verifyAgainstDummy, credentialState, CREDENTIAL_STATE } from '../passwords.ts'
import { startSession } from '../sessions.ts'
import { issueChallenge, maskPhone } from '../otp.ts'
import { findAccount } from './find-account.ts'
import type { GwcApp } from '../../../app.ts'

const invalidCredentials = () =>
  forbidden(PROBLEMS.INVALID_CREDENTIALS, 'Those credentials are not valid.')

/**
 * The sign-in rule (auth-api.md §3.1–§3.2), framework-free: it takes plain
 * data plus the app's decorations (`pg`, `audit`, `sendOtp`, `denylist`,
 * `mintAccessToken`) and returns a plain outcome describing what happened.
 * The controller shapes that outcome into cookies/status codes/response body.
 *
 * Two rules run through this and are worth stating once:
 *
 *   - **Non-enumeration.** An unknown address and a wrong password are
 *     indistinguishable in body, status code and timing (§3.1).
 *   - **A status gate issues no token** (FR-010). Each returns its §3.2 remedy
 *     instead: locked ⇒ contact support, inactive ⇒ reset to reactivate, ended
 *     ⇒ no remedy.
 */
export type SignInInput = {
  email: string
  password: string
  deviceId?: string
  /** Which client is asking; a deviceId marks the mobile face. */
  face?: string
  ip?: string
  userAgent?: string
  requestId?: string
  signal?: AbortSignal
}

export async function signIn(
  app: GwcApp,
  { email, password, deviceId, face, ip, userAgent, requestId, signal }: SignInInput,
) {
  const account = await findAccount(app, email, signal)

  // The dummy verification runs for a missing account, so an unknown address
  // costs the same time as a wrong password.
  if (!account) {
    await verifyAgainstDummy(password)
    await app.audit({ action: 'sign_in_refused', outcome: 'denied', requestId, detail: { reason: 'no-account' } })
    throw invalidCredentials()
  }

  const { kind, row } = account

  // A legacy MD5 value is treated as already public and is never verified;
  // the account resets instead (FR-014).
  if (credentialState(row) === CREDENTIAL_STATE.RESET_REQUIRED) {
    await verifyAgainstDummy(password)
    await app.audit({
      action: 'sign_in_refused', outcome: 'denied', requestId,
      actorId: row.id, actorKind: kind, detail: { reason: 'password_reset_required' },
    })
    return { outcome: 'password_reset_required' }
  }

  if (!(await verifyPassword(row.password_hash, password))) {
    await app.audit({
      action: 'sign_in_refused', outcome: 'denied', requestId,
      actorId: row.id, actorKind: kind, detail: { reason: 'bad-password' },
    })
    throw invalidCredentials()
  }

  // ---- Status gates. None of these issues a token (FR-010). ----------
  if (kind === 'member') {
    if (row.status === 'locked') throw forbidden(PROBLEMS.ACCOUNT_LOCKED, 'This account is locked. Please contact support.')
    if (row.status === 'inactive') throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This account is inactive. Reset your password to reactivate it.')
    if (row.status === 'ended') throw forbidden(PROBLEMS.MEMBERSHIP_ENDED, 'This membership has ended.')

    // ---- Applicants (feature 009) ----------------------------------------
    // Somebody who registered in the app and is not yet approved. They get a
    // token on exactly one condition: the device they applied from, with the
    // mobile number already proven — which is how they resume onboarding after
    // losing the app's stored session. The token then opens /onboarding/* and
    // nothing else (10-auth). Anywhere else, no token: web has no device, and
    // an applicant must not reach the portal by signing in there.
    const { rows: applications } = await query(
      app.pg,
      'SELECT state, device_id FROM membership_applications WHERE member_id = $1',
      [row.id],
      { signal },
    )
    const application = applications[0]
    if (application && application.state !== 'approved') {
      const onItsDevice = Boolean(deviceId) && deviceId === application.device_id && row.mobile_verified_at !== null
      if (onItsDevice) {
        const challenge = await issueChallenge(app.pg, {
          accountId: row.id, accountKind: 'member', deviceId: deviceId!, purpose: 'login', signal,
        })
        await app.sendOtp?.({ mobile: row.mobile, code: challenge.code })
        return {
          outcome: 'otp_required',
          challengeId: challenge.challengeId,
          expiresIn: OTP_TTL_SECONDS,
          sentTo: maskPhone(row.mobile),
        }
      }
      if (application.state === 'denied') {
        throw forbidden(PROBLEMS.APPLICATION_DENIED, 'This membership application was not approved.')
      }
      return { outcome: row.email_confirmed_at === null ? 'profile_incomplete' : 'approval_pending' }
    }

    if (row.email_confirmed_at === null) {
      return { outcome: 'profile_incomplete' }
    }

    if (deviceId) {
      const { rows: approvals } = await query(
        app.pg,
        'SELECT state FROM device_approvals WHERE member_id = $1 AND device_id = $2',
        [row.id, deviceId],
        { signal },
      )
      if (approvals[0]?.state !== 'approved') {
        return { outcome: 'approval_pending' }
      }

      // §6.2: mobile sign-in takes a second factor. No token is issued yet —
      // the challenge is.
      if (row.mobile_verified_at !== null) {
        const challenge = await issueChallenge(app.pg, {
          accountId: row.id, accountKind: 'member', deviceId, purpose: 'login', signal,
        })
        await app.sendOtp?.({ mobile: row.mobile, code: challenge.code })
        return {
          outcome: 'otp_required',
          challengeId: challenge.challengeId,
          expiresIn: OTP_TTL_SECONDS,
          // Masked: the full number is never echoed pre-authentication.
          sentTo: maskPhone(row.mobile),
        }
      }
    }
  } else if (kind === 'merchant' || kind === 'partner') {
    // The same status vocabulary members use, and the same refusals — an
    // organisation principal is a person with an account, not a special case
    // with its own rules.
    if (row.status === 'locked') throw forbidden(PROBLEMS.ACCOUNT_LOCKED, 'This account is locked. Please contact support.')
    if (row.status !== 'active') throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This account is not active.')
    // An organisation that is suspended or ended cannot be worked on, whatever
    // the state of the person's own account.
    if (row.organisation_status !== 'active' && row.organisation_status !== 'pending') {
      throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This organisation is not active.')
    }
  } else if (!row.is_active) {
    throw forbidden(PROBLEMS.ACCOUNT_INACTIVE, 'This staff account is not active.')
  }

  const session = await startSession(app.pg, {
    accountId: row.id,
    accountKind: kind,
    deviceId: deviceId ?? null,
    userAgent: userAgent ?? null,
    ip,
    face,
  })

  for (const sid of session.supersededSessionIds) await app.denylist.add(sid)

  const { token, expiresIn } = app.mintAccessToken({
    accountId: row.id, sessionId: session.sessionId, audience: kind,
  })

  await app.audit({
    action: 'sign_in', outcome: 'allowed', requestId,
    actorId: row.id, actorKind: kind, detail: { sessionId: session.sessionId },
  })

  const principal = { id: row.id, kind, displayName: row.display_name ?? null }

  return {
    outcome: 'authenticated',
    face,
    token,
    expiresIn,
    refreshToken: session.refreshToken,
    principal,
  }
}
