# Research: Device sessions

Findings are from reading the code on 2026-11-17, not from the production database.

## R1. What blocks "web and phone at once" today
- `sessions` has `one_active_session_per_account` (partial unique on `(account_id, account_kind) WHERE revoked_at IS NULL`, migration 007); `startSession` revokes the active session first (`superseded`), and callers add it to the denylist.
- `10-auth.ts` (~l.270) refuses every member request on a phone with no approved `device_approvals` row (`deviceApproved`), and `sign-in.ts` (~l.136) returns `approval_pending` for it.
- Sign-in on a phone with a verified mobile always sends an SMS code (`sign-in.ts` after the approval check).
- **Decision**: replace the account-wide rule with a per-device one for members; delete the per-request device gate; keep staff/org on the old index.
- **Rejected**: keeping the index and exempting `kind='mobile'` (web would still be killed by a phone sign-in).

## R2. Where "known phone" lives
- `device_approvals` is keyed `(member_id, device_id)` and is written only by `onboarding/application/review.ts` and the demo seed. It has staff-review columns, not "this phone passed an SMS code".
- **Decision**: new `member_devices.known_at`; backfill from `device_approvals WHERE state='approved'`. `device_approvals` is left in place (still written by `review.ts`; read by nothing at sign-in).
- **Rejected**: dropping `device_approvals` (history; the application-review flow and its tests use it).

## R3. Web browser identity
- The web sends no `deviceId`, and `sessions.device_id IS NULL` is used as "web" in several places (`sign-in.ts` `resumingOnWeb`, `membership_applications.device_id IS NULL`).
- **Decision**: leave `sessions.device_id` untouched; identify a browser by `member_devices.device_key` set from a cookie. Cookie `gwc_bid`: random 128-bit, httpOnly, Secure outside dev, SameSite=Lax, path `/auth`, long-lived; the server stores SHA-256 only. Sign-in without it issues one.
- **Rejected**: a fingerprint of UA/IP (unstable, privacy-heavy); localStorage id (readable by script).
- Open point for tasks: the console's refresh cookie is scoped to `/auth/refresh` (CLAUDE.md); the new cookie only needs `/auth/sign-in`, so `path=/auth` is enough.

## R4. Forgetting a phone
- Triggers: member ends the device (D3); `revokeAllSessions` is used for password reset only (`confirm-password-reset.ts`); status changes (locked/inactive/ended) revoke with `status_change`, in code to be located in the staff/status path (task: `grep -rn "status_change" server/src` found only seed text, so the revoking site must be traced before implementing).
- **Decision**: one helper `forgetMemberDevices(memberId)` called from both; spec edge case ("forgets every phone") is my inference and is flagged in spec.md.

## R5. Idle expiry
- `sessions.expire` revokes sessions whose unconsumed refresh token expired. Mobile/web refresh TTLs come from `REFRESH_TTL_DAYS` in `@gwc/contracts/auth`.
- **Decision**: add a second predicate `last_seen_at < now() - interval '30 days'` with reason `expired`. **Migration rule from 043**: a new revoke reason must be in `sessions_revoked_reason_check` in the same change; this feature adds `device_ended` (member ended it) there.
- The TTL constants must be read before coding: if a refresh TTL is shorter than 30 days the existing predicate already wins for that face.

## R6. Denylist and push devices
- `denylist.add(sid)` closes the access-token window after revocation; every revoke path in this feature calls it.
- `revokeSession(..., { forgetPushDevices })` exists; its comment ("one session per account, so a web sign-in would silence the phone") stops being true and should be rewritten. Ending a device from the list passes `forgetPushDevices: true`.

## R7. Contracts and clients
- `signInRequestSchema.deviceId` and `verifyOtpRequestSchema.deviceId` exist; add optional `deviceLabel` (max 64) to both. Outcome list: no `device_approval_pending` (025's addition is dropped, D8).
- App has `expo-device` and `expo-constants`; settings live under `(member)/profile/`. Web has `client/src/member/`; the exact settings screen is found at task time.
