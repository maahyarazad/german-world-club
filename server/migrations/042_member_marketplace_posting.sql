-- Every member may post on the Marketplace, except job offers (feature 021,
-- specs/021-member-marketplace-posting/research.md R2, R4).
--
-- Re-runnable: the UPDATE matches nothing the second time, and the trigger is
-- dropped and re-created.

SET LOCAL client_min_messages = warning;

-- 1. Retire `marketplace_post` (R2) -------------------------------------------
--
-- Posting no longer depends on a per-member flag, so the stored key grants
-- nothing. Left in place, `/auth/me` would keep reporting a permission that
-- means nothing, and the next reader would assume it matters. This retires a
-- concept rather than deciding anything about a member, so it writes no audit
-- row. Members are updated, never deleted (their DELETE trigger is untouched).
UPDATE members
   SET permissions = permissions - 'marketplace_post'
 WHERE permissions ? 'marketplace_post';

-- 2. No NEW job offers (R4) ---------------------------------------------------
--
-- NOT a CHECK constraint, which would be the obvious way to write "never job +
-- offer". Postgres re-evaluates a CHECK on every UPDATE of a row, so marking a
-- job offer that predates this migration `filled` or `withdrawn`, expiring it,
-- or hiding and restoring it would all fail — and those listings must wind
-- down normally (spec FR-008). `NOT VALID` only skips the initial scan.
--
-- So the trigger refuses the CREATION of a job offer, three ways:
--   * inserting one;
--   * changing a listing into one (category or mode changed to job + offer);
--   * publishing a legacy draft job offer (draft → active, FR-009).
-- Every other update of an existing job offer passes.
--
-- The application refuses first with a clean 422 (`modesFor` in
-- @gwc/contracts/marketplace); this is the guarantee behind it, and the
-- controller maps the violation to the same problem should a path skip that.
CREATE OR REPLACE FUNCTION marketplace_listings_no_new_job_offer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.category = 'job' AND NEW.mode = 'offer' AND (
       TG_OP = 'INSERT'
       OR OLD.category IS DISTINCT FROM 'job'
       OR OLD.mode IS DISTINCT FROM 'offer'
       OR (OLD.state = 'draft' AND NEW.state = 'active')
     ) THEN
    RAISE EXCEPTION 'members cannot offer a job'
      USING ERRCODE = 'check_violation',
            CONSTRAINT = 'marketplace_no_new_job_offer',
            TABLE = 'marketplace_listings';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS marketplace_listings_no_new_job_offer ON marketplace_listings;
CREATE TRIGGER marketplace_listings_no_new_job_offer
  BEFORE INSERT OR UPDATE OF category, mode, state ON marketplace_listings
  FOR EACH ROW EXECUTE FUNCTION marketplace_listings_no_new_job_offer();
