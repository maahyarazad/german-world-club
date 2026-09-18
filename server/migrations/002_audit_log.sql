-- Append-only audit trail (FR-015).
--
-- Separate from application logs: log records rotate and belong to operators,
-- whereas these are business evidence that staff must be able to query and that
-- must survive rotation. Append-only is enforced by revoked grants rather than
-- by convention (Constitution Principle IV).
CREATE TABLE IF NOT EXISTS audit_log (
  id                  bigserial PRIMARY KEY,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  request_id          text,
  actor_id            uuid,
  actor_kind          account_kind,
  action              text NOT NULL,
  target_type         text,
  target_id           uuid,
  required_permission text,
  outcome             text NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),
  detail              jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx       ON audit_log (actor_id, actor_kind);
CREATE INDEX IF NOT EXISTS audit_log_action_idx      ON audit_log (action, occurred_at DESC);

-- Enforced at the database, so an append-only guarantee does not depend on
-- every future code path remembering it.
CREATE OR REPLACE FUNCTION audit_log_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
