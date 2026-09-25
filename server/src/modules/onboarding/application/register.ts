import { randomUUID } from 'node:crypto'
import { OTP_TTL_SECONDS } from '@gwc/contracts/auth'
import { query, withTransaction } from '../../../db/query.ts'
import { hashPassword, verifyPassword } from '../../auth/passwords.ts'
import { issueChallenge, maskPhone, WEB_DEVICE } from '../../auth/otp.ts'
import type { PoolClient } from 'pg'
import type { GwcApp } from '../../../app.ts'
import type { RegisterRequest, RegisterResponse } from '@gwc/contracts/onboarding'

/**
 * Registration, for both faces: steps 1 and 2 of §6.1 (details, then country
 * of residence), submitted together — each client collects them on two screens
 * and sends one request, so an applicant is never half-created between them.
 *
 * What it creates, in one transaction:
 *   - the member row, `active` but with neither contact detail verified;
 *   - the membership application, `pending`, bound to the requesting device
 *     (or to none, on the web);
 *   - a mobile-verification challenge, whose code is sent by SMS *before*
 *     commit.
 *
 * Sending inside the transaction is the reverse of messaging's persist-then-
 * notify rule, on purpose. There, a failed push must not lose a message the
 * sender was told was accepted. Here, an application whose code never arrived
 * is worth nothing, and committing it anyway would leave an address that cannot
 * register again. If the SMS fails, nothing happened, and the applicant retries.
 */
export async function register(
  app: GwcApp,
  input: RegisterRequest & { ip?: string; requestId?: string; signal?: AbortSignal },
): Promise<RegisterResponse> {
  const { email, password, mobile, deviceId, requestId, signal } = input

  // The SMS country policy, before any lookup or any row: an applicant whose
  // number the club cannot text would otherwise be left with an account they
  // can never verify. The verdict depends only on the number typed, so it
  // answers identically whether or not the address is registered — it cannot
  // be used to probe for members.
  app.assertSmsDestination(mobile, 'onboarding.register')

  const { rows } = await query(
    app.pg,
    `SELECT m.id, m.password_hash, m.mobile_verified_at, a.state AS application_state
       FROM members m
       LEFT JOIN membership_applications a ON a.member_id = m.id
      WHERE m.email = $1`,
    [email],
    { signal },
  )
  const existing = rows[0]

  if (existing) {
    // Resuming an application that stalled before its SMS code was entered —
    // the app was closed, the code expired. Proven by the password, so an
    // address alone cannot be used to redirect somebody else's application to
    // a different phone.
    const resumable = existing.application_state === 'pending'
      && existing.mobile_verified_at === null
      && existing.password_hash !== null
      && (await verifyPassword(existing.password_hash, password))

    if (resumable) {
      return withTransaction(app.pg, async (client) => {
        await writeDetails(client, existing.id, input)
        // Resuming on another face moves the application there: approval
        // follows the device the applicant actually finished on.
        await client.query(
          'UPDATE membership_applications SET device_id = $2 WHERE member_id = $1',
          [existing.id, deviceId ?? null],
        )
        return challengeAndSend(app, client, { memberId: existing.id, mobile, deviceId })
      }, { signal })
    }

    return addressInUse(app, { email, mobile, requestId })
  }

  const passwordHash = await hashPassword(password)
  try {
    const result = await withTransaction(app.pg, async (client) => {
      const { rows: created } = await client.query(
        `INSERT INTO members (email, password_hash, status) VALUES ($1, $2, 'active') RETURNING id`,
        [email, passwordHash],
      )
      const memberId = String(created[0].id)
      await writeDetails(client, memberId, input)
      await client.query(
        'INSERT INTO membership_applications (member_id, device_id) VALUES ($1, $2)',
        // NULL: applied on the web, where nothing is device-bound.
        [memberId, deviceId ?? null],
      )
      const sent = await challengeAndSend(app, client, { memberId, mobile, deviceId })
      return { memberId, sent }
    }, { signal })

    await app.audit({
      action: 'membership_application_started', outcome: 'allowed', requestId,
      actorId: result.memberId, actorKind: 'member',
      targetType: 'membership_application', targetId: result.memberId,
    })
    return result.sent
  } catch (err) {
    // Two registrations for one address raced, and the other won. From here it
    // is simply an address that is in use.
    if ((err as { code?: string })?.code === '23505') return addressInUse(app, { email, mobile, requestId })
    throw err
  }
}

async function writeDetails(client: PoolClient, memberId: string, input: RegisterRequest) {
  // `display_name` holds the full name, as everywhere else on the platform.
  // It is written here once; changing it later is §3.2's justified request.
  await client.query(
    `UPDATE members
        SET display_name = $2, mobile = $3, birthday = $4, gender = $5, country_of_residence = $6
      WHERE id = $1`,
    [memberId, input.fullName, input.mobile, input.birthday, input.gender, input.countryOfResidence],
  )
}

async function challengeAndSend(
  app: GwcApp,
  client: PoolClient,
  { memberId, mobile, deviceId }: { memberId: string; mobile: string; deviceId: string | undefined },
): Promise<RegisterResponse> {
  const challenge = await issueChallenge(client, {
    accountId: memberId, accountKind: 'member', deviceId: deviceId ?? WEB_DEVICE, purpose: 'mobile_verification',
  })
  // Through the SMS gateway like every send; inside the transaction, so a
  // refused or failed send rolls the new account back with it.
  await app.sendOtp({ mobile, code: challenge.code, route: 'onboarding.register', accountId: memberId })
  return { challengeId: challenge.challengeId, expiresIn: OTP_TTL_SECONDS, sentTo: maskPhone(mobile) }
}

/**
 * The address already belongs to somebody.
 *
 * The response has the same shape as a real one, carrying a challenge id that
 * exists nowhere, so the answer itself is not a membership oracle. That is not
 * the whole of non-enumeration and does not pretend to be: no SMS arrives, so
 * somebody holding the phone they typed in can tell. What closes the loop is
 * the mail — the address's owner learns someone tried, and it is keyed per
 * hour so repeated attempts cannot flood their inbox.
 */
async function addressInUse(
  app: GwcApp,
  { email, mobile, requestId }: { email: string; mobile: string; requestId?: string },
): Promise<RegisterResponse> {
  await app.enqueueMail({
    to: email,
    template: 'onboarding.address-in-use',
    subjectKey: `address-in-use:${new Date().toISOString().slice(0, 13)}`,
  })
  await app.audit({
    action: 'membership_application_refused', outcome: 'denied', requestId,
    detail: { reason: 'address-in-use' },
  })
  return { challengeId: randomUUID(), expiresIn: OTP_TTL_SECONDS, sentTo: maskPhone(mobile) }
}
