-- Device sessions (feature 026, specs/026-device-sessions/).
--
-- A member may be signed in on the web and on phones at once. Until now the
-- platform kept ONE active session per account (migration 007), so a sign-in on
-- one face ended the other, and a phone also needed a staff approval row it
-- could never get. This migration replaces the account-wide rule with a
-- per-device one for members; staff and organisation accounts are unchanged.
--
-- Why in the database (constitution IV): the rule is a unique index, so two
-- concurrent sign-ins on one device are a constraint violation handled
-- deterministically, not a race.
--
-- Re-runnable: every statement is IF NOT EXISTS / DROP IF EXISTS / ON CONFLICT.

SET LOCAL client_min_messages = warning;

-- 1. The device -------------------------------------------------------------
--
-- A row outlives its sessions: "known phone" (no SMS code next time) has to
-- survive a sign-out, which revokes the session row. `known_at` is mobile-only;
-- NULL means the next sign-in on that phone needs the SMS code again.
CREATE TABLE IF NOT EXISTS member_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('web', 'mobile')),
  -- Phone: the app's own device id. Web: SHA-256 hex of the browser cookie, so
  -- a database read never yields a value that could be replayed as the cookie.
  device_key    text NOT NULL,
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  known_at      timestamptz,
  UNIQUE (member_id, kind, device_key),
  CONSTRAINT only_phones_are_known CHECK (kind = 'mobile' OR known_at IS NULL)
);

CREATE INDEX IF NOT EXISTS member_devices_member_idx ON member_devices (member_id, last_seen_at DESC);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS member_device_id uuid REFERENCES member_devices (id);

-- 2. Carry existing data over ----------------------------------------------
--
-- An APPROVED device_approvals row means staff vouched for that phone, so it
-- becomes a known phone. Pending and denied rows are ignored: they neither
-- block nor trust. `device_approvals` itself is left untouched.
INSERT INTO member_devices (member_id, kind, device_key, label, known_at)
SELECT member_id, 'mobile', device_id, 'Phone', coalesce(reviewed_at, now())
  FROM device_approvals
 WHERE state = 'approved'
ON CONFLICT (member_id, kind, device_key) DO NOTHING;

-- Attach live member sessions. The old index allowed one per account, so each
-- gets exactly one device and the per-device index below cannot be violated.
INSERT INTO member_devices (member_id, kind, device_key, label)
SELECT s.account_id, 'mobile', s.device_id, 'Phone'
  FROM sessions s
 WHERE s.account_kind = 'member' AND s.revoked_at IS NULL
   AND s.member_device_id IS NULL AND s.device_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM members m WHERE m.id = s.account_id)
ON CONFLICT (member_id, kind, device_key) DO NOTHING;

UPDATE sessions s
   SET member_device_id = d.id
  FROM member_devices d
 WHERE s.account_kind = 'member' AND s.revoked_at IS NULL AND s.member_device_id IS NULL
   AND s.device_id IS NOT NULL
   AND d.member_id = s.account_id AND d.kind = 'mobile' AND d.device_key = s.device_id;

-- A live web session has no browser id yet. Give it a one-off row whose key
-- matches no cookie; it ends with the session and the browser gets a real id at
-- its next sign-in.
WITH web AS (
  SELECT s.id AS session_id, s.account_id,
         'legacy-' || gen_random_uuid()::text AS device_key
    FROM sessions s
   WHERE s.account_kind = 'member' AND s.revoked_at IS NULL
     AND s.member_device_id IS NULL AND s.device_id IS NULL
     AND EXISTS (SELECT 1 FROM members m WHERE m.id = s.account_id)
), made AS (
  INSERT INTO member_devices (member_id, kind, device_key, label)
  SELECT account_id, 'web', device_key, 'Web browser' FROM web
  RETURNING id, member_id, device_key
)
UPDATE sessions s
   SET member_device_id = made.id
  FROM web JOIN made ON made.device_key = web.device_key
 WHERE s.id = web.session_id;

-- 3. The rules, as indexes ---------------------------------------------------
--
-- Staff and organisation sessions (no device row) keep ONE active session per
-- account. Members get one per device.
DROP INDEX IF EXISTS one_active_session_per_account;
CREATE UNIQUE INDEX one_active_session_per_account
  ON sessions (account_id, account_kind)
  WHERE revoked_at IS NULL AND member_device_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_device
  ON sessions (member_device_id)
  WHERE revoked_at IS NULL AND member_device_id IS NOT NULL;

-- 4. A new revocation reason. As in 043, a reason written by code must be in
-- this list in the same change, or the write fails on the first matching row.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_revoked_reason_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_revoked_reason_check CHECK (
  revoked_reason IS NULL OR revoked_reason IN (
    'superseded', 'logout', 'staff_action', 'token_reuse', 'status_change', 'password_reset',
    'expired', 'device_ended'
  )
);

-- 5. Losing good standing forgets every phone --------------------------------
--
-- Nothing in the application revokes a member's sessions when staff lock or end
-- a membership (the auth gate simply refuses a non-active member). Forgetting
-- lives here so it holds however the status changed, including an ad-hoc UPDATE.
CREATE OR REPLACE FUNCTION members_forget_devices() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('locked', 'inactive', 'ended') AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE member_devices SET known_at = NULL WHERE member_id = NEW.id AND known_at IS NOT NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_forget_devices ON members;
CREATE TRIGGER members_forget_devices AFTER UPDATE OF status ON members
  FOR EACH ROW EXECUTE FUNCTION members_forget_devices();
