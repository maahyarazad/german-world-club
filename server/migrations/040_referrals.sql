-- Referral links and XP (feature 018, specs/018-referral-xp/data-model.md).
--
-- Every person who can sign in has one personal link; a new member who
-- registers through it is credited to its owner, who earns XP. XP is to become
-- real money later (spec), so this schema treats it as money now:
--
--   * one referrer per person, one award per referral and one reversal per
--     award are UNIQUE constraints, not checks in a code path (Principle IV,
--     research R4) — a retried or concurrent verification cannot pay twice;
--   * referrals, XP entries and rate changes are append-only BY TRIGGER, so the
--     guarantee holds against a hand-typed UPDATE in psql too (FR-014, R5);
--   * there is no balance column. A balance is SUM(amount) over the entries and
--     cannot disagree with them (FR-015).
--
-- TRUNCATE fires no row triggers. Only the test reset uses it
-- (tests/helpers/db.ts resetReferrals); nothing in src/ truncates these tables.

-- Every trigger below is created as `DROP TRIGGER IF EXISTS` + `CREATE
-- TRIGGER`, so the file is safe to re-run. On a first apply each DROP finds
-- nothing and Postgres prints a NOTICE ("does not exist, skipping") — six of
-- them, which read like failures and are not. LOCAL: the runner wraps each file
-- in its own transaction, so this lasts for this file only.
SET LOCAL client_min_messages = warning;

-- Not used below, which is what allows ADD VALUE inside the runner's
-- transaction (as in 030_server_faults.sql).
ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'referrals';

DO $$ BEGIN
  CREATE TYPE referral_link_state AS ENUM ('active', 'retired', 'disabled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE xp_entry_kind AS ENUM ('award', 'reversal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- --- Rates -------------------------------------------------------------------
-- The XP a referral earns. The rate in force is the newest row; an award copies
-- the amount it was given (and points at the row), so changing the rate never
-- rewrites what somebody already earned (FR-013). A table rather than a setting
-- because "what was the rate on date X" is a question the payout feature will
-- have to answer from data, not from the audit log.
CREATE TABLE IF NOT EXISTS referral_xp_rates (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  xp             integer     NOT NULL CHECK (xp BETWEEN 1 AND 100000),
  effective_from timestamptz NOT NULL DEFAULT now(),
  -- NULL only on the initial row this migration writes.
  set_by         uuid        REFERENCES admin_users (id) ON DELETE RESTRICT,
  reason         text        NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS referral_xp_rates_current
  ON referral_xp_rates (effective_from DESC, id DESC);

-- --- Links ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referral_links (
  id               uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic and without a foreign key, like sessions.account_id: owners live
  -- in members, organisation_users and admin_users, which are separate tables
  -- on purpose (§5). 'admin' is staff.
  owner_kind       account_kind        NOT NULL,
  owner_id         uuid                NOT NULL,
  -- Crockford base-32, stored normalised. UNIQUE over every code ever issued,
  -- retired and disabled ones included, so a code is never handed to a second
  -- person: an old link someone still has must never credit a stranger.
  code             text                NOT NULL UNIQUE CHECK (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  state            referral_link_state NOT NULL DEFAULT 'active',
  created_at       timestamptz         NOT NULL DEFAULT now(),
  state_changed_at timestamptz,
  disabled_by      uuid                REFERENCES admin_users (id) ON DELETE RESTRICT,
  disabled_reason  text                CHECK (disabled_reason IS NULL OR length(btrim(disabled_reason)) BETWEEN 1 AND 500),
  CONSTRAINT referral_links_disabled_says_who_and_why
    CHECK ((state = 'disabled') = (disabled_by IS NOT NULL AND disabled_reason IS NOT NULL)),
  CONSTRAINT referral_links_left_active_says_when
    CHECK ((state = 'active') = (state_changed_at IS NULL))
);

-- At most one active link per person (FR-002). Two concurrent "create my link"
-- requests, or a double-clicked Replace, lose here rather than leaving two.
CREATE UNIQUE INDEX IF NOT EXISTS referral_links_one_active
  ON referral_links (owner_kind, owner_id) WHERE state = 'active';
CREATE INDEX IF NOT EXISTS referral_links_by_owner
  ON referral_links (owner_kind, owner_id, created_at DESC);

-- A link leaves 'active' once — replaced by its owner, or disabled by staff —
-- and is final after that. Nothing else about it ever changes, and it is never
-- deleted: referrals point at the link they came through.
CREATE OR REPLACE FUNCTION referral_links_transition() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'referral links are never deleted';
  END IF;
  IF NEW.owner_kind IS DISTINCT FROM OLD.owner_kind OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.code IS DISTINCT FROM OLD.code OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'a referral link''s owner, code and creation time never change';
  END IF;
  IF OLD.state <> 'active' THEN
    RAISE EXCEPTION 'referral link % is already % and cannot change', OLD.id, OLD.state;
  END IF;
  IF NEW.state = 'active' THEN
    RAISE EXCEPTION 'an update to an active referral link must retire or disable it';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referral_links_transition ON referral_links;
CREATE TRIGGER referral_links_transition BEFORE UPDATE OR DELETE ON referral_links
  FOR EACH ROW EXECUTE FUNCTION referral_links_transition();

-- --- The code an applicant brought, until their number is proven ---------------
-- Written by /onboarding/register (and overwritten when a stalled application
-- is resumed: the last code entered before verification wins), read once by
-- /onboarding/verify-mobile, which is where the referral is actually recorded
-- (research R1). No foreign key, deliberately: the reader re-checks the link
-- anyway (R2), and a foreign key would make referral_links impossible to
-- TRUNCATE in tests without cascading into every application.
ALTER TABLE membership_applications
  ADD COLUMN IF NOT EXISTS pending_referral_link_id uuid;

-- --- Referrals ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
  id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id           uuid         NOT NULL REFERENCES referral_links (id) ON DELETE RESTRICT,
  -- Copied from the link (checked below), so "whose referrals" needs no join.
  referrer_kind     account_kind NOT NULL,
  referrer_id       uuid         NOT NULL,
  -- One referrer per person, ever (R4). The deterministic reference that makes
  -- a retried verification a no-op rather than a second referral.
  referee_member_id uuid         NOT NULL UNIQUE REFERENCES members (id) ON DELETE RESTRICT,
  -- When registration completed: the referee's mobile verification.
  created_at        timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS referrals_by_referrer
  ON referrals (referrer_kind, referrer_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION referrals_match_link() RETURNS trigger AS $$
DECLARE
  link referral_links%ROWTYPE;
BEGIN
  SELECT * INTO link FROM referral_links WHERE id = NEW.link_id;
  IF link.owner_kind IS DISTINCT FROM NEW.referrer_kind OR link.owner_id IS DISTINCT FROM NEW.referrer_id THEN
    RAISE EXCEPTION 'a referral''s referrer must be the owner of the link it came through';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referrals_match_link ON referrals;
CREATE TRIGGER referrals_match_link BEFORE INSERT ON referrals
  FOR EACH ROW EXECUTE FUNCTION referrals_match_link();

-- --- XP entries -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS xp_entries (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_kind        account_kind  NOT NULL,
  owner_id          uuid          NOT NULL,
  kind              xp_entry_kind NOT NULL,
  amount            integer       NOT NULL,
  referral_id       uuid          NOT NULL REFERENCES referrals (id) ON DELETE RESTRICT,
  -- One reversal per award, ever (FR-020).
  reverses_entry_id uuid          UNIQUE REFERENCES xp_entries (id) ON DELETE RESTRICT,
  rate_id           uuid          REFERENCES referral_xp_rates (id) ON DELETE RESTRICT,
  reason            text          NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_by        uuid          REFERENCES admin_users (id) ON DELETE RESTRICT,
  created_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT xp_entries_award_shape CHECK (
    kind <> 'award'
    OR (amount > 0 AND rate_id IS NOT NULL AND reverses_entry_id IS NULL AND created_by IS NULL)),
  CONSTRAINT xp_entries_reversal_shape CHECK (
    kind <> 'reversal'
    OR (amount < 0 AND rate_id IS NULL AND reverses_entry_id IS NOT NULL AND created_by IS NOT NULL))
);

-- One award per referral (R4, SC-003).
CREATE UNIQUE INDEX IF NOT EXISTS xp_entries_one_award_per_referral
  ON xp_entries (referral_id) WHERE kind = 'award';
-- The balance and the history, per owner.
CREATE INDEX IF NOT EXISTS xp_entries_by_owner
  ON xp_entries (owner_kind, owner_id, created_at DESC, id DESC);

-- An award belongs to its referral's referrer; a reversal cancels exactly one
-- award, of the same owner and referral, for exactly its amount. A CHECK cannot
-- read another row, so these are a trigger.
CREATE OR REPLACE FUNCTION xp_entries_consistent() RETURNS trigger AS $$
DECLARE
  ref    referrals%ROWTYPE;
  target xp_entries%ROWTYPE;
BEGIN
  SELECT * INTO ref FROM referrals WHERE id = NEW.referral_id;
  IF ref.referrer_kind IS DISTINCT FROM NEW.owner_kind OR ref.referrer_id IS DISTINCT FROM NEW.owner_id THEN
    RAISE EXCEPTION 'XP from a referral belongs to that referral''s referrer';
  END IF;
  IF NEW.kind = 'reversal' THEN
    SELECT * INTO target FROM xp_entries WHERE id = NEW.reverses_entry_id;
    IF target.kind IS DISTINCT FROM 'award' THEN
      RAISE EXCEPTION 'only an award can be reversed';
    END IF;
    IF target.referral_id <> NEW.referral_id OR target.owner_kind <> NEW.owner_kind OR target.owner_id <> NEW.owner_id THEN
      RAISE EXCEPTION 'a reversal belongs to the same owner and referral as the award it cancels';
    END IF;
    IF NEW.amount <> -target.amount THEN
      RAISE EXCEPTION 'a reversal cancels exactly the amount awarded (%), not %', target.amount, NEW.amount;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS xp_entries_consistent ON xp_entries;
CREATE TRIGGER xp_entries_consistent BEFORE INSERT ON xp_entries
  FOR EACH ROW EXECUTE FUNCTION xp_entries_consistent();

-- --- Append-only ------------------------------------------------------------------
-- One function for the three ledgers; the message names the table.
CREATE OR REPLACE FUNCTION referral_ledger_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not permitted', TG_TABLE_NAME, TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS referrals_append_only ON referrals;
CREATE TRIGGER referrals_append_only BEFORE UPDATE OR DELETE ON referrals
  FOR EACH ROW EXECUTE FUNCTION referral_ledger_is_append_only();

DROP TRIGGER IF EXISTS xp_entries_append_only ON xp_entries;
CREATE TRIGGER xp_entries_append_only BEFORE UPDATE OR DELETE ON xp_entries
  FOR EACH ROW EXECUTE FUNCTION referral_ledger_is_append_only();

DROP TRIGGER IF EXISTS referral_xp_rates_append_only ON referral_xp_rates;
CREATE TRIGGER referral_xp_rates_append_only BEFORE UPDATE OR DELETE ON referral_xp_rates
  FOR EACH ROW EXECUTE FUNCTION referral_ledger_is_append_only();

-- --- The initial rate ---------------------------------------------------------------
-- 100 XP until staff say otherwise (research R11). Written once: re-running the
-- migration on a database that already has a rate adds nothing.
INSERT INTO referral_xp_rates (xp, set_by, reason)
SELECT 100, NULL, 'initial rate'
 WHERE NOT EXISTS (SELECT 1 FROM referral_xp_rates);
