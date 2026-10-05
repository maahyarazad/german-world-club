-- Onboarding Phase 2 profiling, revision 6 (feature 013): the partner answers
-- the German questionnaire from Q2 (languages, qualification, occupation,
-- income) and is never asked where they will settle.
--
-- Dropping a column is not a row write, so the trigger that makes a completed
-- partner row final does not fire and nothing is disabled here. The CHECK
-- constraints on these columns go with them.

ALTER TABLE member_profiling_partner
  DROP COLUMN IF EXISTS settling_status,
  DROP COLUMN IF EXISTS settling_country,
  DROP COLUMN IF EXISTS settling_city,
  DROP COLUMN IF EXISTS settling_work_duration;
