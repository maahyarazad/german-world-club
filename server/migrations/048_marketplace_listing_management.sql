-- Marketplace listing management (feature 037, data-model.md).
--
-- Re-runnable: every statement is IF NOT EXISTS or guarded.
--
-- 1. Where a disabled listing came from ---------------------------------------
--
-- Staff "disable" is `hidden`, and it now works from `draft` as well as from
-- `active`. Enabling must put a listing back where its owner left it, and a
-- draft must never be published by a restore — so the state it was in is kept.
--
-- NULL on every row that is not hidden, and on hidden rows that predate this
-- column. A legacy NULL means `active`, which is what restore always did, so
-- no backfill is needed and no existing row changes meaning.
ALTER TABLE marketplace_listings
  ADD COLUMN IF NOT EXISTS hidden_from_state marketplace_state;

DO $$ BEGIN
  -- NOT VALID first, then VALIDATE: the same two-step the job-offer rule in 042
  -- uses, so adding the constraint never needs a long lock on a busy table.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'listings_hidden_from_state_check') THEN
    ALTER TABLE marketplace_listings
      ADD CONSTRAINT listings_hidden_from_state_check
      CHECK (hidden_from_state IS NULL
             OR (state = 'hidden' AND hidden_from_state IN ('draft', 'active')))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE marketplace_listings VALIDATE CONSTRAINT listings_hidden_from_state_check;

-- 2. The staff listing page ----------------------------------------------------
--
-- The existing indexes are partial on `state = 'active'` (the member index) or
-- keyed by owner. The staff page lists every state, newest first, paged by
-- keyset on (created_at, id), so it needs its own.
CREATE INDEX IF NOT EXISTS listings_staff_idx
  ON marketplace_listings (created_at DESC, id DESC);
