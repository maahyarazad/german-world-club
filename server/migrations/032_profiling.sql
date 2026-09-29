-- Onboarding Phase 2: Profiling (feature 013, specs/013-onboarding-profiling).
--
-- Mandatory, gated the same way Phase 1 approval already is: a member with
-- membership_applications.state = 'approved' and no completed row here is
-- refused every ordinary member route until profiling is done
-- (server/src/plugins/10-auth.ts). country_of_residence (020_onboarding.sql)
-- decides the branch once, at first answer, and it is never recomputed.

-- ---------------------------------------------------------------------------
-- Designated club cities
-- ---------------------------------------------------------------------------

-- Maintained independently of any member's submission (research R4): a
-- non-German applicant's nearest city is checked against this list, not the
-- other way around, so the list can grow without touching past submissions.
CREATE TABLE IF NOT EXISTS gwc_cities (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  country    char(2)     NOT NULL,
  city       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT gwc_cities_country_is_iso CHECK (country ~ '^[A-Z]{2}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS gwc_cities_country_city_unique ON gwc_cities (country, lower(city));

-- The club's designated cities are the seven United Arab Emirates emirates.
-- Staff maintain this by hand until a management UI is requested (spec.md
-- Assumptions); ON CONFLICT makes the seed idempotent.
INSERT INTO gwc_cities (country, city) VALUES
  ('AE', 'Abu Dhabi'),
  ('AE', 'Dubai'),
  ('AE', 'Sharjah'),
  ('AE', 'Ajman'),
  ('AE', 'Umm Al Quwain'),
  ('AE', 'Ras Al Khaimah'),
  ('AE', 'Fujairah')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Profiling answers
-- ---------------------------------------------------------------------------

-- One row per member who has answered at least one question. Absence means
-- "not started" — branch is not known from this table alone until then; it is
-- computed on the fly from country_of_residence (see application/status.ts).
CREATE TABLE IF NOT EXISTS member_profiling (
  member_id   uuid        PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT,
  -- Frozen at the first answer. A later correction to country_of_residence
  -- must not retroactively change which questions "should have" applied.
  branch      text        NOT NULL,

  -- Germany branch (Q1–Q5).
  settling_status     text,
  languages            text[],
  qualification_level  text,
  occupation            text,
  desired_work_type    text,

  -- Elsewhere branch: one primary city, up to two secondary.
  primary_city_country     char(2),
  primary_city_name        text,
  secondary_city_1_country char(2),
  secondary_city_1_name    text,
  secondary_city_2_country char(2),
  secondary_city_2_name    text,
  matched_gwc_city_id      uuid REFERENCES gwc_cities (id) ON DELETE RESTRICT,
  outcome                  text,

  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT member_profiling_branch CHECK (branch IN ('germany', 'elsewhere')),
  CONSTRAINT member_profiling_settling_status CHECK (settling_status IS NULL OR settling_status IN ('know_where', 'need_help')),
  CONSTRAINT member_profiling_qualification_level CHECK (qualification_level IS NULL OR qualification_level IN (
    'no_formal_qualification', 'secondary_school', 'diploma_certificate', 'associate_degree',
    'bachelors_degree', 'masters_degree', 'doctorate', 'professional_qualification'
  )),
  CONSTRAINT member_profiling_occupation CHECK (occupation IS NULL OR occupation IN (
    'student', 'unemployed', 'self_employed_business_owner', 'government_employee',
    'private_sector_employee', 'teacher_educator', 'healthcare_professional', 'engineer',
    'it_software_professional', 'accountant_finance_professional', 'lawyer_legal_professional',
    'sales_marketing_professional', 'consultant', 'homemaker', 'retired', 'freelancer', 'other'
  )),
  CONSTRAINT member_profiling_desired_work_type CHECK (desired_work_type IS NULL OR desired_work_type IN (
    'employee', 'freelance', 'own_business', 'not_sure'
  )),
  CONSTRAINT member_profiling_primary_city_country_is_iso CHECK (primary_city_country IS NULL OR primary_city_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_secondary_1_country_is_iso CHECK (secondary_city_1_country IS NULL OR secondary_city_1_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_secondary_2_country_is_iso CHECK (secondary_city_2_country IS NULL OR secondary_city_2_country ~ '^[A-Z]{2}$'),
  CONSTRAINT member_profiling_outcome CHECK (outcome IS NULL OR outcome IN ('in_person_meeting', 'gwc_city_match')),

  -- A row cannot carry the other branch's answers.
  CONSTRAINT member_profiling_germany_fields_only_in_germany_branch CHECK (
    branch = 'germany' OR (
      settling_status IS NULL AND languages IS NULL AND qualification_level IS NULL
      AND occupation IS NULL AND desired_work_type IS NULL
    )
  ),
  CONSTRAINT member_profiling_elsewhere_fields_only_in_elsewhere_branch CHECK (
    branch = 'elsewhere' OR (
      primary_city_country IS NULL AND primary_city_name IS NULL
      AND secondary_city_1_country IS NULL AND secondary_city_1_name IS NULL
      AND secondary_city_2_country IS NULL AND secondary_city_2_name IS NULL
      AND matched_gwc_city_id IS NULL AND outcome IS NULL
    )
  ),
  CONSTRAINT member_profiling_outcome_only_when_complete CHECK (outcome IS NULL OR completed_at IS NOT NULL),
  CONSTRAINT member_profiling_match_implies_gwc_outcome CHECK (
    (matched_gwc_city_id IS NULL) = (outcome IS DISTINCT FROM 'gwc_city_match')
  )
);

-- A decision is final, the same rule membership_applications_decision_is_final
-- enforces for Phase 1 (020_onboarding.sql): once complete, a member-facing
-- route cannot edit the row. Staff-side correction, if ever needed, is out of
-- scope for this feature and would need its own, explicit escape hatch.
CREATE OR REPLACE FUNCTION member_profiling_complete_is_final() RETURNS trigger AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'profiling for % is already complete', OLD.member_id;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_profiling_final ON member_profiling;
CREATE TRIGGER member_profiling_final BEFORE UPDATE ON member_profiling
  FOR EACH ROW EXECUTE FUNCTION member_profiling_complete_is_final();
