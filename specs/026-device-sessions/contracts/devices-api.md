# Contract: member devices

Both routes: `config.auth = { audience: 'member' }`, member principal only, `cache-control: private, no-store`,
no `onboarding`/`profiling` flag (an applicant is refused as on every other member route). Types go in
`packages/contracts/src/devices.ts`; no client declares its own.

## GET /member/devices
200
```json
{ "devices": [
  { "id": "uuid", "kind": "web|mobile", "label": "Chrome on macOS",
    "firstSeenAt": "ISO", "lastSeenAt": "ISO", "current": true }
] }
```
- Only devices with an active session. Newest `lastSeenAt` first. `current` is the device of the caller's own session.
- Never returned: IP, user agent, device key, token, session id, `known_at`.

## DELETE /member/devices/{id}
- 204 on success; idempotent for an already-ended device of the caller.
- Ends that device's session (reason `device_ended`), denylists it, deletes its refresh tokens and push devices, and for a phone clears `known_at`. Audited (`device_ended`, actor = member).
- `{id}` is the current device: behaves as sign-out (reason `logout`, phone stays known), 204.
- `{id}` not the caller's or unknown: **404**, identical body and headers (test compares).

## Changed existing contracts
- `POST /auth/sign-in` and `/auth/verify-otp`: optional `deviceLabel` (string, ≤64).
- `POST /auth/sign-in` outcome `authenticated` is now returned for a known phone; `otp_required` for an unknown one; `approval_pending` only for an *application*.
- Web sign-in response sets `gwc_bid` when absent.
