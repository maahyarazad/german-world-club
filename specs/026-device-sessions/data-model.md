# Data Model: Device sessions

## `member_devices` (new)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| member_id | uuid NOT NULL FK members | members are never deleted |
| kind | text CHECK ('web','mobile') | |
| device_key | text NOT NULL | phone: the app's `deviceId`; web: SHA-256 hex of the browser cookie |
| label | text NOT NULL | derived display name, max 64 |
| first_seen_at | timestamptz default now() | |
| last_seen_at | timestamptz default now() | |
| known_at | timestamptz NULL | mobile only; NULL = the next sign-in needs the SMS code. CHECK (kind='mobile' OR known_at IS NULL) |

`UNIQUE (member_id, kind, device_key)`. A row survives session end (that is what "known" needs).

## `sessions` (changed)
- add `member_device_id uuid REFERENCES member_devices(id)`, NULL for staff/org sessions.
- keep `device_id` (still the phone id for mobile, NULL for web) so nothing that reads it changes.
- `one_active_session_per_account` is recreated `WHERE revoked_at IS NULL AND member_device_id IS NULL`.
- new `UNIQUE (member_device_id) WHERE revoked_at IS NULL AND member_device_id IS NOT NULL`.
- `sessions_revoked_reason_check` gains `device_ended`.

## State transitions
- Phone: unknown → (verified SMS code | application approved | backfill) → known → (member ends it | account lock/ended/inactive | password reset) → unknown.
- Session: active → revoked(`logout` | `device_ended` | `expired` | `token_reuse` | `status_change` | `password_reset` | `superseded` for same-device re-sign-in).

## Backfill
`INSERT INTO member_devices … SELECT member_id, 'mobile', device_id, 'Phone', known_at=reviewed_at FROM device_approvals WHERE state='approved'`; existing active member sessions are attached to a row by `(account_id, device_id)` (web sessions get a one-off row with a key that matches no browser; they end at their normal expiry). If an account has more than one active member session after attach (cannot happen today), the newest wins and the rest are revoked `superseded` in the migration.

`device_approvals` is unchanged.
