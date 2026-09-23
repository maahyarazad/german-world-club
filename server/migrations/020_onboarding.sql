-- Mobile onboarding, Phase 1 (feature 009).
--
-- register (name, mobile, birthday, gender) → country of residence → verify
-- mobile → verify email → "waiting for approval" → staff approve or deny.
--
-- Staff approval replaces the invitation as the gate for this path (a business
-- decision, recorded in specs/009-expo-client/spec.md). Invited and legacy
-- members never applied, so they have no row in membership_applications and
-- nothing here changes for them.

-- Registration fields. Nullable: every member who joined before this feature
-- joined without them, and inventing a birthday for them is not an option.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS birthday             date,
  ADD COLUMN IF NOT EXISTS gender               text,
  -- ISO 3166-1 alpha-2. Phase 2 profiling branches on it (DE vs. elsewhere).
  ADD COLUMN IF NOT EXISTS country_of_residence char(2);

DO $$ BEGIN
  ALTER TABLE members ADD CONSTRAINT members_gender_known
    CHECK (gender IS NULL OR gender IN ('female', 'male', 'diverse', 'prefer_not_to_say'));
  ALTER TABLE members ADD CONSTRAINT members_country_is_iso
    CHECK (country_of_residence IS NULL OR country_of_residence ~ '^[A-Z]{2}$');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An application for membership, one per member.
--
-- A table rather than columns on members, for two reasons. First, the absence
-- of a row is meaningful: it is how an invited or legacy member is told apart
-- from an applicant, and a nullable state column would make "never applied"
-- and "forgot to set it" the same value. Second, the gate in 10-auth refuses
-- any member whose row is not `approved` — on every face. Approval tied only to
-- device_approvals would let an applicant with a confirmed email sign in on the
-- web, which has no device, and walk straight past review.
CREATE TABLE IF NOT EXISTS membership_applications (
  member_id     uuid           PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT,
  -- The device the application was made from. Approving the application
  -- approves this device and no other (§6.1, §12.6).
  device_id     text           NOT NULL,
  state         approval_state NOT NULL DEFAULT 'pending',
  -- Set when the email address is confirmed: the application is complete and
  -- only then does it reach the staff queue. A half-finished registration is
  -- not something staff should spend time reviewing.
  submitted_at  timestamptz,
  denial_reason text,
  reviewed_by   uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz    NOT NULL DEFAULT now(),
  updated_at    timestamptz    NOT NULL DEFAULT now(),

  -- §6.1: a denial carries a reason, and the reason is emailed.
  CONSTRAINT applications_denial_states_its_reason
    CHECK (state <> 'denied' OR length(btrim(coalesce(denial_reason, ''))) > 0),
  -- Nobody reviews an application that was never completed.
  CONSTRAINT applications_reviewed_after_submission
    CHECK (state = 'pending' OR (submitted_at IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS membership_applications_queue_idx
  ON membership_applications (submitted_at) WHERE state = 'pending' AND submitted_at IS NOT NULL;

-- A decision is final. Review is a one-way step in §6.1's flow, and a trigger
-- rather than a WHERE clause in the review code, so a hand-run UPDATE cannot
-- quietly un-deny somebody either.
CREATE OR REPLACE FUNCTION membership_applications_decision_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD.state <> 'pending' AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'membership application for % was already %', OLD.member_id, OLD.state;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS membership_applications_final ON membership_applications;
CREATE TRIGGER membership_applications_final BEFORE UPDATE ON membership_applications
  FOR EACH ROW EXECUTE FUNCTION membership_applications_decision_is_final();

-- Two more one-time-code purposes. Same table, same attempt ceiling and the
-- same device binding: an onboarding code is no less guessable than a login
-- code, so it gets no weaker rules.
ALTER TABLE otp_challenges DROP CONSTRAINT IF EXISTS otp_challenges_purpose_check;
ALTER TABLE otp_challenges ADD CONSTRAINT otp_challenges_purpose_check
  CHECK (purpose IN ('login', 'device_approval', 'mobile_verification', 'email_verification'));
