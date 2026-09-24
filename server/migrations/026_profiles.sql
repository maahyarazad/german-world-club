-- Profiles for every identity (feature 010, specs/010-threads-profile).
--
-- The member half: a handle to mention and link, an avatar, up to three links.
-- The influencer identity as a staff-granted designation on a member (research
-- R3) — an influencer signs in as a member and can do everything a member can,
-- so a fifth token audience would only duplicate every member route.
-- The organisation half: the projection of an organisation that members may
-- see, as a table of its own (R11).

-- ---------------------------------------------------------------------------
-- Handle and avatar
-- ---------------------------------------------------------------------------

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS handle            citext,
  ADD COLUMN IF NOT EXISTS handle_changed_at timestamptz;

DO $$ BEGIN
  -- Never released, not even when a membership ends: members are never
  -- deleted, so the row keeps its handle, and a newcomer cannot inherit a
  -- former member's mentions and name.
  ALTER TABLE members ADD CONSTRAINT members_handle_unique UNIQUE (handle);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
END $$;

DO $$ BEGIN
  -- The format lives here as well as in @gwc/contracts/profile, so an ad-hoc
  -- UPDATE cannot write a handle the mention parser could never match. The
  -- reserved list is application-side: it is a policy that will change, not
  -- a shape.
  ALTER TABLE members ADD CONSTRAINT members_handle_format
    CHECK (handle IS NULL OR (handle::text ~ '^[a-z0-9._]{3,30}$' AND handle::text !~ '^\.|\.$'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Stamped by the database, not by the caller: the 30-day change rule reads
-- this column, and a code path that forgot to set it would reset the clock.
CREATE OR REPLACE FUNCTION members_stamp_handle_change() RETURNS trigger AS $$
BEGIN
  IF NEW.handle IS DISTINCT FROM OLD.handle THEN
    NEW.handle_changed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_handle_changed ON members;
CREATE TRIGGER members_handle_changed BEFORE UPDATE OF handle ON members
  FOR EACH ROW EXECUTE FUNCTION members_stamp_handle_change();

-- The avatar is a row of its own rather than a column on `members`. A
-- foreign key from `members` to `assets` would put `members` downstream of
-- every `TRUNCATE assets … CASCADE` — the media test harness's reset — and
-- wipe the table that is never supposed to lose a row. It also keeps one more
-- write path off the row that holds the password hash.
CREATE TABLE IF NOT EXISTS member_avatars (
  member_id  uuid        PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT,
  -- RESTRICT: bytes are only ever removed by modules/media, and not while a
  -- profile still shows them.
  asset_id   uuid        NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS member_avatars_asset_idx ON member_avatars (asset_id);

-- ---------------------------------------------------------------------------
-- Profile links
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS member_links (
  member_id uuid     NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  position  smallint NOT NULL,
  url       text     NOT NULL,
  label     text,
  PRIMARY KEY (member_id, position),
  CONSTRAINT member_links_position CHECK (position BETWEEN 0 AND 2),
  -- https only: a javascript: or data: URL rendered as a link on somebody
  -- else's screen is the attack, not an edge case.
  CONSTRAINT member_links_url CHECK (url ~ '^https://[^[:space:]]+$' AND char_length(url) <= 200),
  CONSTRAINT member_links_label CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 40)
);

-- ---------------------------------------------------------------------------
-- Designations (influencer)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  -- An enum rather than text: a new designation is a migration and a review,
  -- not a string somebody typed into a staff form.
  CREATE TYPE member_designation AS ENUM ('influencer');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS member_designations (
  id            uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid               NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  designation   member_designation NOT NULL,
  granted_at    timestamptz        NOT NULL DEFAULT now(),
  granted_by    uuid               REFERENCES admin_users (id) ON DELETE SET NULL,
  grant_reason  text               NOT NULL,
  revoked_at    timestamptz,
  revoked_by    uuid               REFERENCES admin_users (id) ON DELETE SET NULL,
  revoke_reason text,

  CONSTRAINT member_designations_grant_reason CHECK (length(btrim(grant_reason)) BETWEEN 3 AND 2000),
  -- A revocation is complete or absent. `revoked_by` may later be nulled by
  -- ON DELETE SET NULL, so it is not part of the all-or-nothing rule.
  CONSTRAINT member_designations_revocation_complete CHECK (
    (revoked_at IS NULL) = (revoke_reason IS NULL)
    AND (revoke_reason IS NULL OR length(btrim(revoke_reason)) BETWEEN 3 AND 2000)
  ),
  CONSTRAINT member_designations_revoked_after_grant CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);

-- At most one ACTIVE designation of a kind per member. History rows (revoked)
-- are unconstrained, so grant → revoke → grant is three facts, not an update.
CREATE UNIQUE INDEX IF NOT EXISTS member_designations_one_active
  ON member_designations (member_id, designation) WHERE revoked_at IS NULL;

-- History is kept. There is no application role to revoke a grant from on
-- this platform, so the rule is a trigger, the same mechanism audit_log uses:
-- rows are never deleted, and only an active row's revocation may be written.
CREATE OR REPLACE FUNCTION member_designations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'member_designations rows are history and are never deleted; revoke instead';
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'designation % is already revoked, which is final', OLD.id;
  END IF;
  IF NEW.member_id IS DISTINCT FROM OLD.member_id
     OR NEW.designation IS DISTINCT FROM OLD.designation
     OR NEW.granted_at IS DISTINCT FROM OLD.granted_at
     OR NEW.grant_reason IS DISTINCT FROM OLD.grant_reason THEN
    RAISE EXCEPTION 'a designation''s grant is not edited after the fact';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS member_designations_guard ON member_designations;
CREATE TRIGGER member_designations_guard BEFORE UPDATE OR DELETE ON member_designations
  FOR EACH ROW EXECUTE FUNCTION member_designations_guard();

-- ---------------------------------------------------------------------------
-- Organisation public profile
-- ---------------------------------------------------------------------------

-- A separate table, not columns on `organisations`: that table carries the
-- fee tier and contract dates, which no member may see. Here, a careless
-- query cannot reach them because they are not in the table (research R11).
CREATE TABLE IF NOT EXISTS organisation_profiles (
  organisation_id uuid        PRIMARY KEY REFERENCES organisations (id) ON DELETE RESTRICT,
  display_name    text        NOT NULL,
  about           text,
  website         text,
  city            text,
  logo_asset_id   uuid        REFERENCES assets (id) ON DELETE RESTRICT,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid        REFERENCES organisation_users (id) ON DELETE SET NULL,

  CONSTRAINT organisation_profiles_name    CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
  CONSTRAINT organisation_profiles_about   CHECK (about IS NULL OR char_length(about) <= 1000),
  CONSTRAINT organisation_profiles_website CHECK (website IS NULL OR (website ~ '^https://[^[:space:]]+$' AND char_length(website) <= 200)),
  CONSTRAINT organisation_profiles_city    CHECK (city IS NULL OR char_length(city) <= 120)
);
