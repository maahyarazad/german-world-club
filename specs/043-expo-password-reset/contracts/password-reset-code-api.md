# Contract: Password reset by SMS code

**Feature**: 043-expo-password-reset | Shared schemas and types go in `@gwc/contracts/password-reset` (a new module, separate from `auth.ts` on purpose: validating a mobile number pulls in the phone-metadata library, and `auth.ts` is imported by nearly every web page; `PASSWORD_RESET_CODE_LENGTH` stays in `@gwc/contracts/auth` beside the other OTP constants). Problem types are existing ones; no new problem type is needed.

Two new public routes under `/auth/password-reset/`, beside the existing emailed-link pair (`/request`, `/confirm`), which are **unchanged**. A third existing route, `POST /auth/otp/resend`, gains behaviour for this purpose (section 3). Both new routes are `audience: 'public'`, face-agnostic (the app sends bearer-less JSON; a browser would add its cookie and CSRF header as it does for the existing reset), and answer `cache-control: private, no-store` like every `/auth/` response.

## 1. Ask for a code

`POST /auth/password-reset/code`

```ts
// @gwc/contracts/auth
export const PASSWORD_RESET_CODE_LENGTH = 6

export const passwordResetCodeRequestSchema = z.union([
  z.object({ email: z.string().email().max(320), deviceId: deviceIdSchema }).strict(),
  z.object({ mobile: z.string().refine(isValidMobileE164), deviceId: deviceIdSchema }).strict(),
])
// exactly one of email / mobile; both, or neither, is 400 validation-failed (a failing mobile field is 422 invalid-mobile, below)
// deviceId: z.string().min(1).max(128), the same shape verify-otp uses

export const passwordResetCodeAcceptedSchema = z.object({
  requested: z.literal(true),
  challengeId: z.string().uuid(),
  cooldownSeconds: z.number().int().nonnegative(),   // OTP_RESEND_COOLDOWN_SECONDS, 60
})
```

**Always** `202 { requested: true, challengeId, cooldownSeconds }` for a well-formed request, whatever the identifier matches:

| Identifier | What happens | `challengeId` |
|---|---|---|
| a member with a verified mobile, active or inactive, in a country the club texts | a challenge is issued, an SMS with a six-digit code is sent **after** the reply | the real one |
| no match; a staff, merchant or partner account; a member with no or unverified mobile; a locked or ended member | nothing is issued or sent | a random UUID |
| a match, but the country policy refuses, or the provider fails | challenge issued, send fails, **logged masked**, answer unchanged | the real one (it simply never gets a code) |

Status, body shape and headers are the same in every row (asserted byte-for-byte in tests, ignoring the per-request id and the challenge id value). The body never contains a phone number, a masked number, a name or the words "account" or "member".

**Ending the previous code.** When a challenge is issued, the member's earlier **unspent** `password_reset` challenges are consumed in the same transaction, so only the newest code works (research R3).

**Rate limits** (fail-closed). Before anything is sent:

| Bucket | Dimension | Limit | Notes |
|---|---|---|---|
| `password-reset-sms` (new) | `phone`: the matched member's number, else the typed identifier | 3 per hour | applies equally to a non-match, so a limit is not an oracle |
| `password-reset-ip` (new) | `ip` | about 20 per hour | stops one address spraying many identifiers |

The member is resolved in a `preHandler` that runs **before** the phone limiter, the same pattern as `POST /auth/otp/resend`. Over a limit: `429 rate-limited` with `retry-after`.

**Errors.** `400 validation-failed` (both or neither identifier, a bad email, a missing device id), `422 invalid-mobile` (a number that is not a real mobile number or has no country code: the platform's rule for any failing `mobile` field since feature 031, the same answer registration gives; it says nothing about accounts), `429 rate-limited`. Nothing else: **never** 404, never `sms-destination-not-allowed` (422), never `service-unavailable` (503), because each would reveal an account.

## 2. Choose a new password with the code

`POST /auth/password-reset/code/confirm`

```ts
export const passwordResetCodeConfirmSchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'must be six digits'),
  deviceId: deviceIdSchema,
  password: z.string().min(8).max(256),       // the same bounds as sign-in and the emailed-link confirm
})
// 200 { reset: true }   (the same shape as the existing emailed-link confirm answer: z.object({ reset: z.literal(true) }))
```

The body is validated **first**, so a password that is too short or too long is a `400` and **no guess at the code is spent**. Then:

1. `verifyChallenge(pool, { challengeId, code, deviceId, purposes: ['password_reset'] })`.
2. On `verified`: re-check the member (`status IN ('active','inactive')`); if not, answer as a wrong code.
3. `finishPasswordReset(...)`, shared with the emailed-link flow: set `password_hash`, clear `password_reset_required`, reactivate an `inactive` member, revoke **every** session of the account, add them to the denylist, audit.

| Case | Answer |
|---|---|
| wrong code, expired, already spent, the fifth wrong try (code dead), unknown challenge, another device, another purpose, member no longer eligible | **`401 invalid-otp`, one answer for all of them**: identical status, headers and body. Telling them apart (a `410` for expired, a `429 otp-attempts-exceeded` for exhausted) would let a caller distinguish a real challenge from the random one a non-matching identifier receives, and so learn who has an account (research R17). |
| too many requests against one challenge (`otp-verify` bucket, 60 per 10 minutes, keyed on `challengeId`) | `429 rate-limited` |
| body does not validate | `400 validation-failed` |
| success | `200 { reset: true }` |

A wrong try increments `attempts` and the fifth consumes the challenge (existing behaviour; it simply does not announce itself any more). A code presented to this route that was issued for **any other** purpose is a wrong code (counted as a try, answered `401 invalid-otp`).

## 3. `POST /auth/otp/resend` and a reset challenge

The route, its schema and its answer are unchanged (`{ resent, cooldownSeconds, challengeId }`). For a challenge whose purpose is `password_reset` it answers **exactly as it does for a challenge that does not exist or is spent**: `202`, a random `challengeId`, **nothing sent, nothing issued, nothing consumed**, and the same work done (no members lookup, no phone-keyed limiter). Answering differently, for instance `429` inside the 60-second window, would let a caller tell a real challenge from the random one a non-matching identifier is given (research R17); and a real resend would be a second way to send a reset code outside the three-an-hour budget.

**To get another code, ask again** at `POST /auth/password-reset/code` with the same identifier. The answer carries a new `challengeId` and supersedes the old code (section 1). The app keeps the identifier on the code screen for this.

For every **other** purpose the resend is unchanged, except that the length of the fresh code now comes from `digitsForPurpose(challenge.purpose)` (research R3), so a purpose never silently gets the wrong length.

## 4. Where a reset code is accepted, and where it is not

| Endpoint | Redeems | A `password_reset` code there |
|---|---|---|
| `POST /auth/verify-otp` | `login`, `device_approval` | refused like a wrong code, **opens no session** |
| `POST /onboarding/verify-mobile` | `mobile_verification` | refused like a wrong code, **opens no session** |
| `POST /onboarding/email/verify` | `email_verification` | refused like a wrong code |
| `POST /auth/password-reset/code/confirm` | `password_reset` | **the only place it works** |

(These are asserted in tests, in both directions: a code issued for each of those other purposes is also refused by `/code/confirm`.)

## 5. Audit and logging

- A completed reset: the existing `session_revoked` entry (`detail.reason: 'password_reset'`, `count`) plus a `password_reset` entry with `detail: { reason: 'sms' }`, actor the member. `reason` is already an allowlisted audit key; no allowlist change.
- Sending is not audited per message. The SMS gateway logs the send, destination masked (`•••• 1234`); a refusal or failure logs `SMS_BLOCKED_COUNTRY` / `SMS_PROVIDER_ERROR`.
- `email`, `mobile`, `code` and `password` in a request body are redacted by the existing `REDACT_PATHS`; none is in a URL. A challenge id is not a secret on its own.

## 6. Authorization-matrix rows to add (`server/tests/authz/matrix.test.ts`)

```text
{ name: 'password reset code request', url: '/auth/password-reset/code',         method: 'POST', audience: 'public' }
{ name: 'password reset code confirm', url: '/auth/password-reset/code/confirm', method: 'POST', audience: 'public' }
```

Both are affirmative public declarations that appear in a diff (Principle II). Their rate-limit buckets are declared in `config/rate-limits.ts`, whose startup check refuses a bucket with no dimension.
