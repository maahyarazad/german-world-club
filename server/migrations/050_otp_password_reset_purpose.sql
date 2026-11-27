-- A fifth one-time-code purpose, `password_reset` (feature 043).
--
-- The app resets a forgotten password with a code texted to the number on record,
-- where the website emails a link. A code needs a row in `otp_challenges` (same
-- attempt ceiling, expiry and device binding as every other code), and that table
-- refuses any purpose its CHECK does not name. This is the ONE database change the
-- feature makes: no table, column, index or row.
--
-- Why not reuse an existing purpose, which would need no migration at all:
--   * `mobile_verification` is redeemed by /onboarding/verify-mobile and `login` and
--     `device_approval` by /auth/verify-otp, and each of those OPENS A SESSION for a
--     valid code of its purposes. A reset code filed under one of them would sign a
--     person in with no password, which is the opposite of what a reset is for.
--   * Keeping the code in `password_reset_tokens` instead would put a six-digit code
--     in a table with no attempt counter (both are plain digests), so it could be
--     guessed 1,000,000 times at the request rate.
-- A purpose of its own is what lets `verifyChallenge(…, { purposes })` guarantee, in
-- both directions, that a reset code opens nothing else and nothing else resets
-- (server/tests/auth/password-reset-purpose.test.ts).
--
-- The rule is widened, not removed: an unknown purpose is still refused
-- (server/tests/auth/otp-purpose-constraint.test.ts asserts it).
--
-- Additive and instant: a CHECK that only gains an allowed value cannot fail against
-- existing rows (every row already holds one of the four old values), and the table is
-- small and short-lived (codes expire in five minutes). Written the way 020 wrote the
-- previous widening, DROP then ADD in the one transaction the runner gives each file.
--
-- Rollback (valid once no `password_reset` row remains, and they expire in five minutes):
--   ALTER TABLE otp_challenges DROP CONSTRAINT otp_challenges_purpose_check;
--   ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
--     CHECK (purpose IN ('login', 'device_approval', 'mobile_verification', 'email_verification'));
-- (or `DELETE FROM otp_challenges WHERE purpose = 'password_reset'` first, which loses nothing
-- of value: an unredeemed reset code.)

ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('login', 'device_approval', 'mobile_verification', 'email_verification', 'password_reset'));
