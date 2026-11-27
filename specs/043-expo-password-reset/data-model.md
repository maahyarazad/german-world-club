# Data Model: Reset a forgotten password in the app, by SMS code

**Feature**: 043-expo-password-reset | **Date**: 2026-11-27

This feature adds **no table, no column, no index and no row**. The whole database change is one rule on one existing table, widened by one value. Everything else below is existing structure, listed so the reset's effect on it is explicit.

## 1. The one change: `otp_challenges_purpose_check`

`otp_challenges.purpose` is `text NOT NULL CHECK (purpose IN (…))` and today allows four values (migration `008`, widened by `020`). Migration `050_otp_password_reset_purpose.sql` replaces the rule with one that also allows `password_reset`:

```text
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('login', 'device_approval', 'mobile_verification', 'email_verification', 'password_reset'));
```

- Additive: every existing row already satisfies the new rule, so adding it validates and locks briefly and changes no data.
- Same shape as `020_onboarding.sql`, which did this for the onboarding purposes.
- Rollback: re-add the four-value rule (only valid while no `password_reset` row exists; they expire in five minutes).
- `server/src/modules/auth/otp.ts`'s `IssueChallengeInput.purpose` union gains the same fifth value; that is code, not schema.
- `delete-member.sql` already removes a member's `otp_challenges` by account, so nothing there changes. The table is never seeded (`seed/tables.ts` lists it with the live-credential tables), so nothing in the seeders changes.

## 2. Existing tables this feature reads or writes

### `otp_challenges` (migration 008)

| Column | This feature |
|---|---|
| `id` (uuid) | the `challengeId` the app holds |
| `account_id`, `account_kind` | the member (`account_kind = 'member'`); the lookup that finds them is by `members.email` or `members.mobile` |
| `code_hash` | the six-digit code, `sha256("<id>:<code>")`, salted with the row id so two challenges never share a digest |
| `device_id` | the app's device id (NOT NULL by design); a browser would use `'web'` |
| `purpose` | `'password_reset'` (the widened value) |
| `attempts` | wrong tries; the fifth consumes the row |
| `expires_at` | now + 300 s |
| `consumed_at` | set on success, on the fifth wrong try, or when a newer reset challenge supersedes it |

**Lifecycle of one reset challenge**

```text
issued ──correct code, member still eligible──────────────► consumed (verified)  → password changed
   │   ──5th wrong try────────────────────────────────────► consumed (attempts)  → 429 otp-attempts-exceeded
   │   ──newer reset challenge for the member / a resend──► consumed (superseded)
   └─────past expires_at──────────────────────────────────► expired              → 410 otp-expired
```

Invariant (tested): a member has **at most one** unconsumed, unexpired `password_reset` challenge.

### `members`

| Column | Read for | Written on a completed reset |
|---|---|---|
| `email` | lookup by email (citext, so case-insensitive) | no |
| `mobile` | lookup by number (E.164, **unique**, so at most one match); the SMS destination | no |
| `mobile_verified_at` | eligibility: must be NOT NULL | no |
| `status` | eligibility: `active` or `inactive`; re-checked at redeem | `inactive` becomes `active` (§3.2, as the emailed link already does) |
| `password_hash` | | the new argon2id hash |
| `password_reset_required` | | `false` |

### Sessions: `sessions`, `refresh_tokens`

`revokeAllSessions(pool, accountId, 'member', 'password_reset')` ends every session and refresh token of the member, and each session id is added to the denylist (`app.denylist.add`). The reason `password_reset` already exists in `sessions_revoked_reason_check` (it is what the emailed link records), so no constraint changes. (CLAUDE.md: a new revocation reason must be added to that constraint in the same change; none is new here.)

### `audit_log`

Two rows per completed reset, both existing actions: `session_revoked` (`detail.reason = 'password_reset'`, `detail.count`) and `password_reset` (`detail.reason = 'sms'`). The code, password, email and number are never in `detail` (`reason` and `count` are already in `SAFE_DETAIL_KEYS`).

### `password_reset_tokens`

**Not touched.** The emailed-link flow is unchanged, and this flow mints no token.

## 3. Eligibility, in one place

A code is issued and sent only when **all** hold:

```text
member found by email = $1   OR   mobile = $1
AND mobile IS NOT NULL AND mobile_verified_at IS NOT NULL
AND status IN ('active', 'inactive')
AND the country policy allows texting that number          (decided by app.sendOtp, after the reply)
```

The first three are a single query in `request-password-reset-code.ts`; it names its columns (never `SELECT *`). The country policy is enforced by the one SMS gateway, never re-implemented. Redeeming re-checks `status` inside the transaction that changes the password.

## 4. Constants (shared, code not database)

| Name | Value | Where |
|---|---|---|
| `PASSWORD_RESET_CODE_LENGTH` | 6 | `@gwc/contracts/auth` (new; the schemas that use it are in `@gwc/contracts/password-reset`) |
| `OTP_TTL_SECONDS` | 300 | existing |
| `OTP_MAX_ATTEMPTS` | 5 | existing |
| `OTP_RESEND_COOLDOWN_SECONDS` | 60 | existing |
| `password-reset-sms` bucket | 3 per hour per phone | `config/rate-limits.ts` (new) |
| `password-reset-ip` bucket | about 20 per hour per IP | `config/rate-limits.ts` (new) |
| password length | 8 to 256 | existing (sign-in, emailed-link confirm) |

## 5. Relationships

```text
Member 1 ── 0..1 live password_reset OtpChallenge (bound to one device_id)
Member 1 ── 0..n Session            all ended by a completed reset
Member 1 ── 0..n PasswordResetToken the emailed-link flow; independent of this one
```
