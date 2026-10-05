-- Profiling: Germany, Austria and Switzerland now share the German pathway
-- (business description, Phase 2). Until now only DE did, so an applicant from
-- Austria or Switzerland who had already started was frozen on the non-German
-- branch (member_profiling.branch is set at the first answer and never
-- recomputed).
--
-- Their unfinished rows are removed so they start again on the right pathway:
-- a branch cannot simply be flipped, because the two branches' columns are
-- mutually exclusive by CHECK and the rows hold the other branch's answers.
-- Complete rows are final by trigger and are not touched. The children go
-- first (their foreign keys are RESTRICT); their triggers allow it while the
-- parent is incomplete.
DELETE FROM member_profiling_kids WHERE member_id IN (
  SELECT p.member_id FROM member_profiling p JOIN members m ON m.id = p.member_id
   WHERE p.completed_at IS NULL AND p.branch = 'elsewhere' AND m.country_of_residence IN ('AT', 'CH'));
DELETE FROM member_profiling_partner WHERE member_id IN (
  SELECT p.member_id FROM member_profiling p JOIN members m ON m.id = p.member_id
   WHERE p.completed_at IS NULL AND p.branch = 'elsewhere' AND m.country_of_residence IN ('AT', 'CH'));
DELETE FROM member_profiling WHERE member_id IN (
  SELECT p.member_id FROM member_profiling p JOIN members m ON m.id = p.member_id
   WHERE p.completed_at IS NULL AND p.branch = 'elsewhere' AND m.country_of_residence IN ('AT', 'CH'));
