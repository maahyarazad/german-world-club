-- Onboarding, revision 4 (feature 013): the updated business description.
--
--   Phase 1: Register records the applicant's age confirmation and primary
--            language; non-German speakers are denied automatically and German
--            speakers approved automatically after 24 hours.
--   Phase 2: Q1 settling is a real question (place, and a Dubai follow-up) for
--            the member and the partner; income has five bands; Business Owner
--            picks activities; "not sure" is multi-select with no industry;
--            a non-German member's GWC match decides whether Q6 is asked.
--
-- Constraints that could be violated by an already-complete row (immutable by
-- trigger, so it can never be corrected) are NOT VALID: they bind every later
-- write and never re-check history.

-- ---------------------------------------------------------------------------
-- Phase 1
-- ---------------------------------------------------------------------------

-- Nullable on purpose: members who never apply (the fixed seed:dev accounts,
-- invited members) have no application, and the rules below never touch them.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS primary_language  text,
  ADD COLUMN IF NOT EXISTS age_confirmed_at  timestamptz;

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_primary_language;
ALTER TABLE members ADD CONSTRAINT members_primary_language
  CHECK (primary_language IS NULL OR primary_language IN ('german', 'non_german'));

-- True for the non-German denial and the 24-hour approval: reviewed_by stays
-- NULL for both, and this is what tells them apart from a deleted admin.
ALTER TABLE membership_applications
  ADD COLUMN IF NOT EXISTS decided_automatically boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- Phase 2: new columns
-- ---------------------------------------------------------------------------

ALTER TABLE member_profiling
  ADD COLUMN IF NOT EXISTS settling_country                text,
  ADD COLUMN IF NOT EXISTS settling_city                   text,
  ADD COLUMN IF NOT EXISTS settling_work_duration          text,
  ADD COLUMN IF NOT EXISTS future_work_business_activities text[];

ALTER TABLE member_profiling_partner
  ADD COLUMN IF NOT EXISTS settling_status        text,
  ADD COLUMN IF NOT EXISTS settling_country       text,
  ADD COLUMN IF NOT EXISTS settling_city          text,
  ADD COLUMN IF NOT EXISTS settling_work_duration text;

ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_settling_country_is_iso;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_settling_country_is_iso
  CHECK (settling_country IS NULL OR settling_country ~ '^[A-Z]{2}$');
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_settling_work_duration;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_settling_work_duration
  CHECK (settling_work_duration IS NULL OR settling_work_duration IN ('under_1', '1_3', '3_5', '5_10', 'over_10'));
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_business_activities_valid;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_business_activities_valid CHECK (
  future_work_business_activities IS NULL OR (
    cardinality(future_work_business_activities) >= 1
    AND future_work_business_activities <@ ARRAY['produce', 'distribute', 'sales', 'other']::text[]
  )
);

ALTER TABLE member_profiling_partner DROP CONSTRAINT IF EXISTS member_profiling_partner_settling_status;
ALTER TABLE member_profiling_partner ADD CONSTRAINT member_profiling_partner_settling_status
  CHECK (settling_status IS NULL OR settling_status IN ('know_where', 'need_help'));
ALTER TABLE member_profiling_partner DROP CONSTRAINT IF EXISTS member_profiling_partner_settling_country_is_iso;
ALTER TABLE member_profiling_partner ADD CONSTRAINT member_profiling_partner_settling_country_is_iso
  CHECK (settling_country IS NULL OR settling_country ~ '^[A-Z]{2}$');
ALTER TABLE member_profiling_partner DROP CONSTRAINT IF EXISTS member_profiling_partner_settling_work_duration;
ALTER TABLE member_profiling_partner ADD CONSTRAINT member_profiling_partner_settling_work_duration
  CHECK (settling_work_duration IS NULL OR settling_work_duration IN ('under_1', '1_3', '3_5', '5_10', 'over_10'));

-- ---------------------------------------------------------------------------
-- Phase 2: replaced constraints
-- ---------------------------------------------------------------------------

-- Two more income bands, for the member and the partner.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_yearly_income_range;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_yearly_income_range
  CHECK (yearly_income_range IS NULL OR yearly_income_range IN ('up_to_50k', '50k_to_100k', 'over_100k', 'over_500k', 'over_1m'));
ALTER TABLE member_profiling_partner DROP CONSTRAINT IF EXISTS member_profiling_partner_yearly_income_range;
ALTER TABLE member_profiling_partner ADD CONSTRAINT member_profiling_partner_yearly_income_range
  CHECK (yearly_income_range IS NULL OR yearly_income_range IN ('up_to_50k', '50k_to_100k', 'over_100k', 'over_500k', 'over_1m'));

-- The new German-only columns join the germany-branch CHECK.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_germany_fields_only_in_germany_branch;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_germany_fields_only_in_germany_branch CHECK (
  branch = 'germany' OR (
    settling_status IS NULL AND settling_country IS NULL AND settling_city IS NULL
    AND settling_work_duration IS NULL AND languages IS NULL AND qualification_level IS NULL
    AND occupation IS NULL AND desired_work_type IS NULL AND yearly_income_range IS NULL
    AND future_work_business_activities IS NULL
  )
);

-- Q7 follow-ups per path. The industry is asked on every path except "not
-- sure"; Business Owner now picks activities instead of writing an idea.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_matches_desired_work_type;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_matches_desired_work_type CHECK (
  (desired_work_type IN ('employee', 'freelance', 'business_owner', 'own_business') OR future_work_sector IS NULL)
  AND (desired_work_type = 'employee' OR future_work_ready IS NULL)
  AND (desired_work_type IN ('freelance', 'own_business') OR future_work_offering IS NULL)
  AND (desired_work_type IN ('freelance', 'own_business') OR future_work_idea IS NULL)
  AND (desired_work_type = 'business_owner' OR future_work_business_activities IS NULL)
  AND (desired_work_type = 'not_sure' OR future_work_priorities IS NULL)
) NOT VALID;

-- "Not sure" is multi-select again (revision 3 made it single).
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_priority_single;
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_priorities_valid;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_priorities_valid CHECK (
  future_work_priorities IS NULL OR (
    cardinality(future_work_priorities) >= 1
    AND future_work_priorities <@ ARRAY['family_time', 'balance_lifestyle', 'wealth_reputation']::text[]
  )
) NOT VALID;

-- The GWC match is now stored when the cities are saved, because it decides
-- whether Q6 is asked; the outcome is still set only at submit. So a match may
-- exist before an outcome does, but an outcome must agree with the match.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_match_implies_gwc_outcome;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_outcome_agrees_with_match CHECK (
  (outcome IS DISTINCT FROM 'gwc_city_match' OR matched_gwc_city_id IS NOT NULL)
  AND (outcome IS DISTINCT FROM 'in_person_meeting' OR matched_gwc_city_id IS NULL)
);

-- Unfinished "not sure" profiles were asked an industry that is no longer part
-- of the path.
UPDATE member_profiling SET future_work_sector = NULL
 WHERE completed_at IS NULL AND desired_work_type = 'not_sure';
