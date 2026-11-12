import { buildOnboardingApp, applicant, register } from '../onboarding/helpers.ts'
import { createMember, createAdmin, bearerFor } from '../helpers/auth.ts'
import { organisationUser } from '../threads/social-helpers.ts'
import type { GwcApp } from '../../src/app.ts'

/**
 * Shared scaffolding for the referral suites (feature 018).
 *
 * The app is the onboarding one — its SMS and mail providers are recorders —
 * because the interesting half of this feature happens inside registration and
 * mobile verification, and the only honest way to read the code a new
 * applicant was texted is where it was texted to.
 */
export const buildReferralApp = buildOnboardingApp

export type Principal = { id: string; kind: 'member' | 'merchant' | 'partner' | 'admin'; headers: Record<string, string>; prefix: string; email: string }

/** A full member: no application row, so neither onboarding gate applies (legacy/invited). */
export async function memberOwner(app: GwcApp, overrides: Parameters<typeof createMember>[1] = {}): Promise<Principal> {
  const member = await createMember(app.pg, { displayName: 'Rita Referrer', ...overrides })
  const { authorization } = await bearerFor(app, { accountId: String(member.id), accountKind: 'member' })
  return { id: String(member.id), kind: 'member', headers: { authorization }, prefix: '/referrals', email: String(member.email) }
}

export async function orgOwner(app: GwcApp, kind: 'merchant' | 'partner'): Promise<Principal> {
  const user = await organisationUser(app, kind)
  const { rows } = await app.pg.query('SELECT email FROM organisation_users WHERE id = $1', [user.id])
  return { id: user.id, kind, headers: user.headers, prefix: `/referrals/${kind}`, email: String(rows[0].email) }
}

export async function staffOwner(app: GwcApp, options: Parameters<typeof createAdmin>[1] = {}): Promise<Principal> {
  const admin = await createAdmin(app.pg, { isAdmin: false, ...options })
  const { authorization } = await bearerFor(app, { accountId: String(admin.id), accountKind: 'admin' })
  return { id: String(admin.id), kind: 'admin', headers: { authorization }, prefix: '/admin/referrals/me', email: String(admin.email) }
}

/** The owner's link, created on first read exactly as a client would. */
export async function linkOf(app: GwcApp, owner: Principal) {
  const response = await app.inject({ method: 'GET', url: owner.prefix, headers: owner.headers })
  if (response.statusCode !== 200) throw new Error(`GET ${owner.prefix} → ${response.statusCode} ${response.body}`)
  return response.json() as { link: { code: string; url: string }; xpBalance: number; counts: Record<string, number> }
}

/**
 * Register a new applicant (optionally with a code) and verify their mobile —
 * which is where a referral is recorded (research R1). Returns the new member's
 * id and their session headers.
 */
export async function registerAndVerify(
  app: GwcApp,
  sms: { mobile: string; code: string }[],
  { referralCode, details = applicant(), verify = true }:
    { referralCode?: string; details?: Record<string, unknown>; verify?: boolean } = {},
) {
  const body = referralCode === undefined ? details : { ...details, referralCode }
  const registered = await register(app, body)
  if (registered.statusCode !== 202) throw new Error(`register → ${registered.statusCode} ${registered.body}`)
  const { challengeId } = registered.json()
  if (!verify) return { registered, challengeId, details, memberId: null as string | null, headers: null }
  const code = sms.filter((s) => s.mobile === details.mobile).at(-1)!.code
  const verified = await app.inject({
    method: 'POST', url: '/onboarding/verify-mobile', payload: { challengeId, code, deviceId: details.deviceId },
  })
  if (verified.statusCode !== 200) throw new Error(`verify-mobile → ${verified.statusCode} ${verified.body}`)
  const tokens = verified.json()
  return {
    registered, challengeId, details,
    memberId: String(tokens.principal.id),
    headers: { authorization: `Bearer ${tokens.accessToken}` } as Record<string, string> | null,
  }
}

/** Raw counts, so assertions can say "exactly one" rather than "at least one". */
export async function counts(app: GwcApp, refereeId?: string) {
  const where = refereeId ? 'WHERE referee_member_id = $1' : ''
  const params = refereeId ? [refereeId] : []
  const { rows: [r] } = await app.pg.query(`SELECT count(*)::int AS n FROM referrals ${where}`, params)
  const { rows: [x] } = await app.pg.query(
    `SELECT count(*)::int AS n FROM xp_entries e ${refereeId ? 'JOIN referrals r ON r.id = e.referral_id WHERE r.referee_member_id = $1 AND' : 'WHERE'} e.kind = 'award'`,
    params,
  )
  return { referrals: Number(r.n), awards: Number(x.n) }
}

export { applicant, register }
