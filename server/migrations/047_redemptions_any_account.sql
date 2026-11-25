-- Redemptions for any kind of account (feature 035, research R8).
--
-- Until now only a member could redeem, so `member_id` was a foreign key. Any
-- active account may now redeem — a member, staff, or a merchant or partner
-- user — and those live in four tables, so the redeemer is a (kind, id) pair,
-- like sessions and assets already are. The foreign key is traded for an insert
-- trigger that proves the account exists and is active, and the table becomes
-- append-only so a row can never later point at nothing.

ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS redeemer_kind account_kind;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS redeemer_id   uuid;
-- Client-generated, sent with the redeem request: a retry or a double tap
-- carries the same one and so returns the original instead of a second row.
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS request_id    uuid;
-- Copied from the offer when redeeming, never edited. They are what the reports
-- group on, and a later change of an offer's category must not rewrite history.
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS organisation_id uuid REFERENCES organisations (id);
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS category_id     uuid REFERENCES offer_categories (id);

-- Rows from before this feature were all members'.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'redemptions' AND column_name = 'member_id') THEN
    UPDATE redemptions SET redeemer_kind = 'member', redeemer_id = member_id
     WHERE redeemer_kind IS NULL;
  END IF;
END $$;

UPDATE redemptions SET request_id = gen_random_uuid() WHERE request_id IS NULL;

UPDATE redemptions r
   SET organisation_id = o.organisation_id, category_id = o.category_id
  FROM offers o
 WHERE o.id = r.offer_id AND (r.organisation_id IS NULL OR r.category_id IS NULL);

ALTER TABLE redemptions ALTER COLUMN redeemer_kind SET NOT NULL;
ALTER TABLE redemptions ALTER COLUMN redeemer_id SET NOT NULL;
ALTER TABLE redemptions ALTER COLUMN request_id SET NOT NULL;
ALTER TABLE redemptions ALTER COLUMN organisation_id SET NOT NULL;
ALTER TABLE redemptions ALTER COLUMN category_id SET NOT NULL;

-- Dropping the column drops redemptions_member_idx and the foreign key with it.
ALTER TABLE redemptions DROP COLUMN IF EXISTS member_id;

CREATE UNIQUE INDEX IF NOT EXISTS redemptions_request_unique
  ON redemptions (redeemer_kind, redeemer_id, request_id);
CREATE INDEX IF NOT EXISTS redemptions_report_idx
  ON redemptions (organisation_id, redeemed_at DESC, id);
CREATE INDEX IF NOT EXISTS redemptions_category_idx
  ON redemptions (category_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS redemptions_redeemer_idx
  ON redemptions (redeemer_kind, redeemer_id, redeemed_at DESC);
CREATE INDEX IF NOT EXISTS redemptions_person_offer_idx
  ON redemptions (offer_id, redeemer_kind, redeemer_id);

-- The redeemer must exist and be active when the row is written. No foreign key
-- can span four tables, so this is the guard; a later edit is impossible
-- (append-only below), so it cannot go stale into a dangling reference.
CREATE OR REPLACE FUNCTION redemptions_check_redeemer() RETURNS trigger AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.redeemer_kind = 'member' THEN
    SELECT status = 'active' INTO ok FROM members WHERE id = NEW.redeemer_id;
  ELSIF NEW.redeemer_kind = 'admin' THEN
    SELECT is_active INTO ok FROM admin_users WHERE id = NEW.redeemer_id;
  ELSE
    -- merchant or partner user: the user and its organisation must both be active.
    SELECT (u.status = 'active' AND o.status = 'active') INTO ok
      FROM organisation_users u
      JOIN organisations o ON o.id = u.organisation_id
     WHERE u.id = NEW.redeemer_id AND o.kind::text = NEW.redeemer_kind::text;
  END IF;

  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'redeemer % (%) does not exist or is not active', NEW.redeemer_id, NEW.redeemer_kind
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS redemptions_check_redeemer ON redemptions;
CREATE TRIGGER redemptions_check_redeemer BEFORE INSERT ON redemptions
  FOR EACH ROW EXECUTE FUNCTION redemptions_check_redeemer();

-- Append-only, like the referral ledger (040): a correction is a new row, and
-- nothing is ever edited or deleted. Tests clear the table only by TRUNCATE,
-- which fires no row trigger.
CREATE OR REPLACE FUNCTION redemptions_are_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'redemptions is append-only: % is not permitted', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS redemptions_append_only ON redemptions;
CREATE TRIGGER redemptions_append_only BEFORE UPDATE OR DELETE ON redemptions
  FOR EACH ROW EXECUTE FUNCTION redemptions_are_append_only();
