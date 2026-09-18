# Contract: Authentication API

**Feature**: `002-server-platform` | **Consumers**: member web, React Native mobile, staff admin console

All three clients use these endpoints. The *mechanism* differs per face (§6.2) — cookies for browsers, bearer tokens for mobile — but the rules below are computed server-side and are identical for all of them (§12.15). Schemas live in `packages/contracts/src/auth.js` and are imported by the API and by every client, so no client can validate differently.

Error responses use the envelope in [http-conventions.md](./http-conventions.md).

---

## Credential model (FR-002)

| | Access token | Refresh token |
|---|---|---|
| Format | JWT, EdDSA (Ed25519) | Opaque, 256-bit random, base64url |
| Lifetime | 10 min | 30 d web · 90 d mobile |
| Web transport | `HttpOnly; Secure; SameSite=Lax` cookie `gwc_at` | `HttpOnly; Secure; SameSite=Strict; Path=/auth/refresh` cookie `gwc_rt` |
| Mobile transport | `Authorization: Bearer <jwt>` | request body, held in device secure storage |
| Server-side record | none | `refresh_tokens`, SHA-256 hash only |

**Access token claims** — the complete set; anything else is a contract violation:

```json
{ "sub": "<account uuid>", "sid": "<session uuid>",
  "aud": "member" | "admin", "typ": "access",
  "jti": "<ulid>", "iat": 1773532800, "exp": 1773533400 }
```

No permission flags, no role matrix, no membership tier, no email, no name. A test asserts the exact claim key set, so a well-meaning addition fails CI rather than silently becoming something a client relies on.

`aud` mismatch is rejected at verification, before any handler runs (FR-003).

---

## `POST /auth/sign-in`

**Posture**: public. **Buckets**: `sign-in-ip` (10 / 15 min per address) **and** `sign-in-account` (5 / 15 min per identifier), both checked, both fail-closed.

```
Request:  { email: string(email), password: string(8..256), deviceId?: string(1..128) }
```

Responses:

| Status | Body | When |
|---|---|---|
| 200 | `{ outcome: "authenticated", expiresIn: 600, principal: {...} }` | Web, no second factor required. Tokens in `Set-Cookie` |
| 200 | `{ outcome: "authenticated", accessToken, refreshToken, expiresIn: 600, principal }` | Mobile, demo account bypass (§6.2) |
| 200 | `{ outcome: "otp_required", challengeId, expiresIn: 300, sentTo: "•••• 1234" }` | Mobile (§6.2). **No tokens issued yet** |
| 200 | `{ outcome: "approval_pending" }` | Device has no `approved` row (§6.1) |
| 200 | `{ outcome: "profile_incomplete" }` | `email_confirmed_at IS NULL` (FR-011) |
| 200 | `{ outcome: "password_reset_required" }` | Legacy import or reactivation (FR-014, §3.2) |
| 401 | problem+json `invalid-credentials` | Unknown email, wrong password, or `password_hash IS NULL` |
| 403 | problem+json `account-locked` / `account-inactive` / `membership-ended` | Status gate (FR-010) |
| 429 | problem+json `rate-limited` + `Retry-After` | Either bucket exceeded |

Rules:

- **`sentTo` is masked.** The full phone number is never echoed, because sign-in is reachable pre-authentication and would otherwise enumerate contact details.
- **`invalid-credentials` is identical** for an unknown email and a wrong password, and the argon2 verification runs against a dummy hash when the account does not exist, so response timing does not distinguish the two. Account existence is not a public fact for an invite-only club (§3.1).
- **Status gates issue no token** (FR-010), and each returns its §3.2 remedy: locked ⇒ contact support, inactive ⇒ reset password to reactivate, ended ⇒ no remedy.
- **On success**, in one transaction: revoke any active session (`superseded`), insert the new session, issue the refresh token, write an audit record, update `last_login_at`. The partial unique index makes a concurrent double sign-in a handled constraint violation rather than a race (FR-004).
- `principal` carries `{ id, kind, displayName }` **only** — never permissions, never entitlement. Clients that need capabilities call `GET /auth/me`.

## `POST /auth/verify-otp` (FR-012)

**Posture**: public. **Bucket**: `otp-verify` (5 attempts per challenge, then the challenge is invalidated), fail-closed.

```
Request:  { challengeId: uuid, code: string(4, digits), deviceId: string }
Response: 200 { accessToken, refreshToken, expiresIn: 600, principal }
          401 problem+json  invalid-otp             (attempts incremented)
          410 problem+json  otp-expired             (past 5 min, or already consumed)
          429 problem+json  otp-attempts-exceeded   (challenge invalidated)
```

`deviceId` must match the device the challenge was issued to (§12.6); a mismatch is `invalid-otp`, not a distinct error, so a challenge cannot be probed across devices. A 4-digit code is only 10,000 possibilities — the attempt ceiling and the 5-minute expiry are what make it safe, not the code.

## `POST /auth/otp/resend`

**Posture**: public. **Bucket**: `otp-send` (3 / hour per phone number, 60 s cooldown), fail-closed.

Returns `202 { resent: true, cooldownSeconds }`, or `429` with `Retry-After` inside the cooldown. This bucket keys on the **phone number**, not the address, because each send costs real money and an address-keyed limit is trivially bypassed.

## `POST /auth/refresh`

**Posture**: public — the refresh token is itself the credential. **Bucket**: `refresh` (60 / hour per session).

```
Request:  { refreshToken: string }   |   web: cookie gwc_rt, plus CSRF token
Response: 200 { accessToken, refreshToken, expiresIn: 600 }   ← both rotate
          401 problem+json  invalid-refresh-token
          401 problem+json  session-revoked
```

Behaviour per [data-model.md §3](../data-model.md), summarised:

| Presented | Action |
|---|---|
| Unknown hash | 401. No session to terminate |
| Valid, unconsumed, session active | Consume, issue successor with `parent_id`, mint access token |
| **Already consumed** | **Replay** ⇒ revoke session (`token_reuse`), delete the lineage, audit, 401 |
| Session already revoked, or expired | 401 |

A replay is treated as compromise, not as a retry: the legitimate holder and an attacker are indistinguishable at this point, so the safe action is to end the lineage.

## `POST /auth/sign-out`

**Posture**: member-authenticated or staff-authenticated.

Revokes the current session (`logout`), deletes its refresh lineage, adds `sid` to the Redis denylist, clears cookies. Returns `204`. **Idempotent** — signing out an already-revoked session is still `204`, because a client retrying after a network failure must not see an error.

## `GET /auth/me`

**Posture**: member-authenticated or staff-authenticated.

```
Member: { id, kind: "member", displayName, emailConfirmed,
          entitlement: { package: 1|2|3|null, validUntil, eventDiscountPct } }
Staff:  { id, kind: "admin", displayName, isAdmin, isSuperadmin,
          modules: { members: {read,write,edit,delete,status}, ... } }
```

This is the **only** place capabilities and entitlement cross the wire, and both are computed at request time — `modules` from the permission snapshot, `entitlement` from the card's validity window (FR-013, §12.2).

Clients use this response to decide what to *display*. They never use it to decide what is *allowed*: the server re-checks every operation, which is what §12.15 requires. A client that hides a button has made a UX decision, not a security one.

`Cache-Control: private, no-store` — a cached capability set is a stale authorization decision.

## `POST /auth/password-reset/request` · `POST /auth/password-reset/confirm`

**Posture**: public. **Bucket**: `password-reset` (3 / hour per email + address), fail-closed.

Request always returns `202 { requested: true }`, whether or not the account exists — same non-enumeration rule as sign-in. Confirm takes a single-use token with a 1-hour expiry, sets the new argon2id hash, clears `password_reset_required`, revokes **all** sessions for the account, and transitions `inactive → active` where applicable (§3.2).

Revoking all sessions on reset is the point of a reset: the likely reason for one is that the old credential is compromised.

---

## Cross-cutting rules

1. **No endpoint returns authorization data in a token.** Verified by a claim-set test.
2. **Non-enumeration**: sign-in and password-reset reveal nothing about account existence, in body, status code, or timing.
3. **CSRF**: every state-changing request from a cookie-bearing client requires a valid double-submit token (`@fastify/csrf-protection`). Bearer clients are exempt — they have no ambient credentials to forge.
4. **Audit**: every sign-in, refusal, OTP failure, refresh replay, and session revocation writes an `audit_log` record with the request id.
5. **Redaction**: `password`, `code`, `refreshToken`, `accessToken`, and `authorization` never reach a log line (FR-048).
6. **Clock skew**: verification allows 30 s of leeway, so a slightly-off client clock does not lock a user out of a 10-minute token.
