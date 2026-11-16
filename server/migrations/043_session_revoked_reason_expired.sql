-- Allow `expired` as a session revocation reason (024,
-- specs/024-onboarding-contact-error/spec.md, User Story 1).
--
-- The `sessions.expire` job (ops/jobs.ts) has revoked sessions whose refresh
-- token expired unused with `revoked_reason = 'expired'` since feature 007 —
-- but this constraint never listed that value. In production the job failed
-- every 15 minutes on the first such session (a partner session) and revoked
-- nothing at all, so stale sessions piled up. Nothing in development showed
-- it: a refresh token there rarely lives long enough to expire unused.
--
-- The list is widened, not loosened: every existing row already satisfies it,
-- and `revocation_is_complete` (revoked_at and revoked_reason set together) is
-- untouched. A new reason in code must be added here in the same change.
--
-- Re-runnable: dropped and re-added under the same name.

SET LOCAL client_min_messages = warning;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_revoked_reason_check;

ALTER TABLE sessions ADD CONSTRAINT sessions_revoked_reason_check CHECK (
  revoked_reason IS NULL OR revoked_reason IN (
    'superseded', 'logout', 'staff_action', 'token_reuse', 'status_change', 'password_reset',
    'expired'
  )
);
