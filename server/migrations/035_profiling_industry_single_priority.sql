-- Onboarding Phase 2 profiling, revision 3 (feature 013):
--   1. the partner is no longer asked "do you already know where you will settle";
--   2. the industry (future_work_sector) is a fixed list, stored as codes;
--   3. the "I am not sure yet" statement is a single choice, not several.
--
-- Rows that are already complete are final by trigger (032) and are left as
-- they are, which is why the new constraints below are NOT VALID: they bind
-- every later write and never re-check history.

ALTER TABLE member_profiling_partner DROP COLUMN IF EXISTS settling_status;

-- Free-text industries entered before the list existed are not codes. An
-- unfinished profile is simply asked the question again; a complete one is
-- untouched.
UPDATE member_profiling SET future_work_sector = NULL WHERE completed_at IS NULL;

-- Several statements were allowed before; keep the first one an unfinished
-- profile had picked.
UPDATE member_profiling
   SET future_work_priorities = future_work_priorities[1:1]
 WHERE completed_at IS NULL AND cardinality(future_work_priorities) > 1;

ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_priority_single;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_priority_single
  CHECK (future_work_priorities IS NULL OR cardinality(future_work_priorities) = 1) NOT VALID;

ALTER TABLE member_profiling DROP CONSTRAINT IF EXISTS member_profiling_future_work_sector_is_listed;
ALTER TABLE member_profiling ADD CONSTRAINT member_profiling_future_work_sector_is_listed
  CHECK (future_work_sector IS NULL OR future_work_sector IN (
    'technology_it', 'finance_banking', 'real_estate', 'construction_engineering', 'retail_ecommerce',
    'hospitality_tourism', 'food_beverage', 'healthcare_pharma', 'education_training', 'manufacturing_industrial',
    'automotive_transportation', 'logistics_supply_chain', 'consulting_professional', 'legal_services',
    'marketing_advertising', 'media_entertainment', 'government_public', 'energy_utilities',
    'telecommunications', 'general_sales', 'other'
  )) NOT VALID;
