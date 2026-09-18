-- Club Merchants and Corporate Club Partners, and the people who sign in for
-- them (feature 003 data-model.md §1).
--
-- A merchant is not a member and a corporate partner is not a membership: the
-- design document is emphatic about both. They are commercial counterparties
-- with contracts, and modelling them as members would put an external party one
-- grant edit away from the member directory.

DO $$ BEGIN
  CREATE TYPE organisation_kind   AS ENUM ('merchant', 'partner');
  CREATE TYPE organisation_status AS ENUM ('pending', 'active', 'suspended', 'ended');
  CREATE TYPE organisation_role   AS ENUM ('owner', 'manager', 'staff');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organisations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Fixed at creation. A merchant never becomes a partner: they buy different
  -- things and are billed on different bands.
  kind                 organisation_kind   NOT NULL,
  legal_name           text                NOT NULL,
  -- Slug-based public URLs, never a bare id (Principle III).
  slug                 citext              NOT NULL UNIQUE,
  status               organisation_status NOT NULL DEFAULT 'pending',
  status_changed_at    timestamptz         NOT NULL DEFAULT now(),
  contract_start       date,
  contract_end         date,
  -- The banded fee from the design document. Recorded as a contract fact,
  -- never computed by a client.
  fee_tier             text,
  -- Merchants are banded by locations, partners by employees. A row that
  -- answered both would be answering a question it was never asked.
  location_count       integer,
  employee_count       integer,
  created_at           timestamptz         NOT NULL DEFAULT now(),
  updated_at           timestamptz         NOT NULL DEFAULT now(),

  CONSTRAINT organisations_band_matches_kind CHECK (
    (kind = 'merchant' AND employee_count IS NULL) OR
    (kind = 'partner'  AND location_count IS NULL)
  ),
  CONSTRAINT organisations_contract_ordered CHECK (
    contract_end IS NULL OR contract_start IS NULL OR contract_end >= contract_start
  ),
  -- Redundant against the primary key, and load-bearing: it lets later tables
  -- carry a composite foreign key onto (id, kind), which is what makes
  -- attaching an employee entitlement to a *merchant* unrepresentable.
  UNIQUE (id, kind)
);

CREATE INDEX IF NOT EXISTS organisations_kind_status_idx ON organisations (kind, status);

-- Ending a commercial relationship is a status transition that preserves
-- history, exactly as it is for members (§12.4). Enforced here so it survives
-- an ad-hoc query, not only the code path that happens to be reviewed.
CREATE OR REPLACE FUNCTION organisations_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'organisations cannot be deleted; set status to ''ended'' instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organisations_refuse_delete ON organisations;
CREATE TRIGGER organisations_refuse_delete BEFORE DELETE ON organisations
  FOR EACH ROW EXECUTE FUNCTION organisations_no_delete();

CREATE TABLE IF NOT EXISTS organisation_users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid              NOT NULL REFERENCES organisations (id),
  -- Unique per organisation, not globally: the same person may legitimately act
  -- for two.
  email           citext            NOT NULL,
  -- NULL means no usable password — sign-in is refused rather than falling back
  -- to anything, the same rule members follow.
  password_hash   text,
  role            organisation_role NOT NULL DEFAULT 'staff',
  -- Reuses member_status: only 'active' may sign in.
  status          member_status     NOT NULL DEFAULT 'active',
  display_name    text,
  last_login_at   timestamptz,
  created_at      timestamptz       NOT NULL DEFAULT now(),
  updated_at      timestamptz       NOT NULL DEFAULT now(),

  UNIQUE (organisation_id, email)
);

CREATE INDEX IF NOT EXISTS organisation_users_org_idx ON organisation_users (organisation_id);

-- An organisation nobody can administer is a support ticket the database can
-- refuse to create. Mirrors the last-superadmin guard on admin_users.
CREATE OR REPLACE FUNCTION organisation_users_keep_one_owner() RETURNS trigger AS $$
DECLARE
  remaining integer;
  target    uuid;
BEGIN
  target := COALESCE(OLD.organisation_id, NEW.organisation_id);

  SELECT count(*) INTO remaining
    FROM organisation_users
   WHERE organisation_id = target
     AND role = 'owner'
     AND status = 'active'
     AND id <> COALESCE(OLD.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF TG_OP = 'UPDATE' AND NEW.role = 'owner' AND NEW.status = 'active' THEN
    RETURN NEW;
  END IF;

  IF remaining = 0 THEN
    RAISE EXCEPTION 'an organisation must keep at least one active owner';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS organisation_users_owner_guard ON organisation_users;
CREATE TRIGGER organisation_users_owner_guard BEFORE UPDATE OR DELETE ON organisation_users
  FOR EACH ROW EXECUTE FUNCTION organisation_users_keep_one_owner();
