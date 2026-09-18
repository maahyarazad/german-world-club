-- Staff accounts and the five-flag matrix of §11 (data-model.md §1, §2).
--
-- §11 states the matrix "should be preserved as-is" and is "finer-grained than
-- a typical single role system". A role enum cannot express "read but not
-- delete on events", so none is used.
CREATE TABLE IF NOT EXISTS admin_users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          citext UNIQUE NOT NULL,
  password_hash  text    NOT NULL,
  display_name   text,
  is_admin       boolean NOT NULL DEFAULT false,
  -- Bypasses every module check (FR-008). Deliberately a column rather than a
  -- row in the matrix: it is not a permission, it is the absence of the check.
  is_superadmin  boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  created_by     uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_permissions (
  admin_user_id uuid         NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  module        admin_module NOT NULL,
  can_read      boolean NOT NULL DEFAULT false,
  can_write     boolean NOT NULL DEFAULT false,
  can_edit      boolean NOT NULL DEFAULT false,
  can_delete    boolean NOT NULL DEFAULT false,
  can_status    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_user_id, module)
);

-- ABSENCE IS DENIAL. A missing row means no flags — never inherited access and
-- never a default. The resolver returns all-false for a module with no row.

CREATE INDEX IF NOT EXISTS admin_permissions_module_idx ON admin_permissions (module);

-- §11 recoverability: a system with no active superadmin cannot grant
-- permissions to anyone and is unrecoverable without direct database access.
-- Enforced by a trigger because the invariant spans rows, which no column
-- constraint can express.
CREATE OR REPLACE FUNCTION admin_users_keep_one_superadmin() RETURNS trigger AS $$
DECLARE
  remaining integer;
BEGIN
  SELECT count(*) INTO remaining
    FROM admin_users
   WHERE is_superadmin = true AND is_active = true AND id <> OLD.id;

  IF OLD.is_superadmin AND OLD.is_active AND remaining = 0 THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'the last active superadmin cannot be removed (§11)';
    END IF;
    IF NEW.is_superadmin = false OR NEW.is_active = false THEN
      RAISE EXCEPTION 'the last active superadmin cannot be demoted or deactivated (§11)';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS admin_users_superadmin_guard ON admin_users;
CREATE TRIGGER admin_users_superadmin_guard BEFORE UPDATE OR DELETE ON admin_users
  FOR EACH ROW EXECUTE FUNCTION admin_users_keep_one_superadmin();
