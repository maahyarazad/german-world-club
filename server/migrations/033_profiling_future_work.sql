-- Onboarding Phase 2 profiling: Q5 conditional follow-up questions (feature
-- 013, added after the business description grew the German branch).
--
-- 032_profiling.sql had already been applied to working databases by the
-- time this requirement landed, so these are new columns rather than an edit
-- to that migration's CREATE TABLE.

ALTER TABLE member_profiling
  ADD COLUMN IF NOT EXISTS future_work_sector     text,
  ADD COLUMN IF NOT EXISTS future_work_ready       boolean,
  ADD COLUMN IF NOT EXISTS future_work_offering    text,
  ADD COLUMN IF NOT EXISTS future_work_idea        text,
  ADD COLUMN IF NOT EXISTS future_work_priorities  text[];

-- The same mutual-exclusion pattern as member_profiling_germany_fields_only_in_germany_branch
-- and its elsewhere counterpart (032_profiling.sql), one level deeper: a row
-- may only carry the follow-up columns for the desired_work_type it holds.
-- When desired_work_type is NULL (Q5 not yet answered), every follow-up
-- column collapses to NULL too.
DO $$ BEGIN
  ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_matches_desired_work_type
    CHECK (
      (desired_work_type = 'employee' OR (future_work_sector IS NULL AND future_work_ready IS NULL))
      AND (desired_work_type IN ('freelance', 'own_business')
           OR (future_work_offering IS NULL AND future_work_idea IS NULL))
      AND (desired_work_type = 'not_sure' OR future_work_priorities IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
