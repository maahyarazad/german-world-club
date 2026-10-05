-- Onboarding Phase 2 profiling, revision 2 (feature 013): a yearly-income
-- question, relationship & family status with kids and a partner
-- questionnaire on both branches, a Business Owner Q7 path, and the industry
-- asked on every Q7 path.
--
-- Additive on purpose. Rows that are already complete are final by trigger
-- (032) and are left exactly as they are — those members are not re-asked.

ALTER TABLE member_profiling
  ADD COLUMN IF NOT EXISTS yearly_income_range text,
  ADD COLUMN IF NOT EXISTS relationship_tags   text[];

ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_yearly_income_range;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_yearly_income_range
  CHECK (yearly_income_range IS NULL OR yearly_income_range IN ('up_to_50k', '50k_to_100k', 'over_100k'));

-- 'single' is exclusive and the array is never empty when present. Both
-- branches use it, so it is deliberately not part of either branch-only CHECK.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_relationship_tags_valid;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_relationship_tags_valid CHECK (
  relationship_tags IS NULL OR (
    cardinality(relationship_tags) >= 1
    AND relationship_tags <@ ARRAY['single', 'partner', 'family', 'kids']::text[]
    AND NOT ('single' = ANY (relationship_tags) AND cardinality(relationship_tags) > 1)
  )
);

-- Q7 gains 'business_owner'.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_desired_work_type;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_desired_work_type
  CHECK (desired_work_type IS NULL OR desired_work_type IN
    ('employee', 'freelance', 'business_owner', 'own_business', 'not_sure'));

-- Income is a German-branch column like the rest of Q1-Q5.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_germany_fields_only_in_germany_branch;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_germany_fields_only_in_germany_branch CHECK (
  branch = 'germany' OR (
    settling_status IS NULL AND languages IS NULL AND qualification_level IS NULL
    AND occupation IS NULL AND desired_work_type IS NULL AND yearly_income_range IS NULL
  )
);

-- Replaces 033's constraint: the industry (future_work_sector) is now asked on
-- every path, and Business Owner shares the "idea" column for its product or
-- service.
ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_matches_desired_work_type;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_matches_desired_work_type CHECK (
  (desired_work_type IS NOT NULL OR future_work_sector IS NULL)
  AND (desired_work_type = 'employee' OR future_work_ready IS NULL)
  AND (desired_work_type IN ('freelance', 'own_business') OR future_work_offering IS NULL)
  AND (desired_work_type IN ('freelance', 'own_business', 'business_owner') OR future_work_idea IS NULL)
  AND (desired_work_type = 'not_sure' OR future_work_priorities IS NULL)
);

-- One row per kid; the count is the row count.
CREATE TABLE IF NOT EXISTS member_profiling_kids (
  member_id uuid     NOT NULL REFERENCES member_profiling (member_id) ON DELETE RESTRICT,
  position  smallint NOT NULL,
  age_range text     NOT NULL,
  PRIMARY KEY (member_id, position),
  CONSTRAINT member_profiling_kids_position CHECK (position BETWEEN 1 AND 20),
  CONSTRAINT member_profiling_kids_age_range CHECK (age_range IN ('age_0_6', 'age_6_14', 'age_14_18', 'age_18_plus'))
);

-- The partner answers the German Q1-Q5. No name or contact detail is stored:
-- the business description asks only for the answers.
CREATE TABLE IF NOT EXISTS member_profiling_partner (
  member_id           uuid PRIMARY KEY REFERENCES member_profiling (member_id) ON DELETE RESTRICT,
  settling_status     text,
  languages           text[],
  yearly_income_range text,
  qualification_level text,
  occupation          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT member_profiling_partner_settling_status CHECK (settling_status IS NULL OR settling_status IN ('know_where', 'need_help')),
  CONSTRAINT member_profiling_partner_yearly_income_range CHECK (yearly_income_range IS NULL OR yearly_income_range IN ('up_to_50k', '50k_to_100k', 'over_100k')),
  CONSTRAINT member_profiling_partner_qualification_level CHECK (qualification_level IS NULL OR qualification_level IN (
    'no_formal_qualification', 'secondary_school', 'diploma_certificate', 'associate_degree',
    'bachelors_degree', 'masters_degree', 'doctorate', 'professional_qualification'
  )),
  CONSTRAINT member_profiling_partner_occupation CHECK (occupation IS NULL OR occupation IN (
    'student', 'unemployed', 'self_employed_business_owner', 'government_employee',
    'private_sector_employee', 'teacher_educator', 'healthcare_professional', 'engineer',
    'it_software_professional', 'accountant_finance_professional', 'lawyer_legal_professional',
    'sales_marketing_professional', 'consultant', 'homemaker', 'retired', 'freelancer', 'other'
  ))
);

-- Kids and the partner are part of the profiling record, so they are final
-- with it. Before completion, DELETE is allowed: it is how changing an
-- earlier answer (dropping the Kids tag, say) removes what no longer applies.
CREATE OR REPLACE FUNCTION member_profiling_children_are_final() RETURNS trigger AS $$
DECLARE target uuid := COALESCE(NEW.member_id, OLD.member_id);
BEGIN
  IF EXISTS (SELECT 1 FROM member_profiling WHERE member_id = target AND completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'profiling for % is already complete', target;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_TABLE_NAME = 'member_profiling_partner' THEN NEW.updated_at := now(); END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_profiling_kids_final ON member_profiling_kids;
CREATE TRIGGER member_profiling_kids_final BEFORE INSERT OR UPDATE OR DELETE ON member_profiling_kids
  FOR EACH ROW EXECUTE FUNCTION member_profiling_children_are_final();

DROP TRIGGER IF EXISTS member_profiling_partner_final ON member_profiling_partner;
CREATE TRIGGER member_profiling_partner_final BEFORE INSERT OR UPDATE OR DELETE ON member_profiling_partner
  FOR EACH ROW EXECUTE FUNCTION member_profiling_children_are_final();
