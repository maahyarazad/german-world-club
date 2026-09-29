-- Server fault records (feature 012, specs/012-error-persistence/data-model.md).
--
-- Until now an unexpected 500 existed only as one log line on stdout: once the
-- output scrolled away or the host rotated it, the request id a member quoted
-- led nowhere. From here the error handler also writes one row per fault.
--
-- Two invariants live here rather than in the application (Principle IV):
--   * a record is never edited — a stack trace amended after the fact is not
--     evidence of anything;
--   * nothing younger than 30 days can be deleted, so even an ad-hoc
--     `DELETE FROM server_faults` in psql removes only expired rows, and a
--     mistyped retention constant cannot erase fresh evidence.
--
-- TRUNCATE fires no row triggers. That is deliberate and used only by the test
-- reset (tests/helpers/db.ts `resetServerFaults`); nothing in src/ truncates.

-- Only `read` is ever granted on it. No grant rows: superadmins pass through
-- authz/permissions.ts, everyone else needs an explicit grant. The value is not
-- used below, which is what allows ADD VALUE inside the runner's transaction.
ALTER TYPE admin_module ADD VALUE IF NOT EXISTS 'server_faults';

CREATE TABLE IF NOT EXISTS server_faults (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at       timestamptz NOT NULL DEFAULT now(),
  -- Server-generated ULID (research R10). Unique: a request ends in at most one
  -- fault, and no client can choose the id — which is what makes UNIQUE safe.
  request_id        text        NOT NULL UNIQUE
                                CHECK (request_id ~ '^[0-9A-HJKMNP-TV-Z]{26}$'),
  -- The client's own correlation id, when it sent a well-formed one. Not unique.
  client_request_id text        CHECK (client_request_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  method            text        NOT NULL CHECK (length(method) <= 10),
  -- The route PATTERN, never a URL: no path values, no query string.
  route             text        CHECK (length(route) <= 300),
  status            smallint    NOT NULL CHECK (status BETWEEN 500 AND 599),
  error_name        text        NOT NULL CHECK (length(error_name) <= 100),
  error_code        text        CHECK (length(error_code) <= 100),
  -- Scrubbed and truncated before insert (src/ops/scrub.ts); the bounds here
  -- stop one pathological error from writing a huge row if that ever regresses.
  message           text        NOT NULL CHECK (length(message) <= 2000),
  stack             text        CHECK (length(stack) <= 8000),
  principal_kind    text        CHECK (principal_kind IN ('member', 'admin', 'merchant', 'partner')),
  -- Opaque internal id, no foreign key (like sessions.account_id): a record
  -- outlives the account it names without cascading.
  principal_id      text,
  fingerprint       char(64)    NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  instance_id       text        NOT NULL CHECK (length(instance_id) <= 200),
  CHECK ((principal_kind IS NULL) = (principal_id IS NULL))
);

-- Newest-first list and its keyset cursor.
CREATE INDEX IF NOT EXISTS server_faults_recent
  ON server_faults (occurred_at DESC, id DESC);
-- Grouping and filtering by fingerprint.
CREATE INDEX IF NOT EXISTS server_faults_by_fingerprint
  ON server_faults (fingerprint, occurred_at DESC);
-- Support correlation by the client's own id.
CREATE INDEX IF NOT EXISTS server_faults_by_client_request
  ON server_faults (client_request_id) WHERE client_request_id IS NOT NULL;

-- How many faults were counted but not stored in full, per instance per
-- minute. The key is the deterministic reference that makes a retried flush
-- add rather than duplicate (Principle IV).
CREATE TABLE IF NOT EXISTS server_fault_suppressions (
  minute      timestamptz NOT NULL CHECK (minute = date_trunc('minute', minute)),
  instance_id text        NOT NULL CHECK (length(instance_id) <= 200),
  suppressed  integer     NOT NULL CHECK (suppressed > 0),
  PRIMARY KEY (minute, instance_id)
);

CREATE OR REPLACE FUNCTION server_faults_refuse_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'server fault records are never edited';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS server_faults_immutable ON server_faults;
CREATE TRIGGER server_faults_immutable BEFORE UPDATE ON server_faults
  FOR EACH ROW EXECUTE FUNCTION server_faults_refuse_update();

-- One function for both tables: each names its own timestamp column, passed as
-- the trigger argument, so the 30-day floor is written exactly once.
CREATE OR REPLACE FUNCTION server_faults_retention_floor() RETURNS trigger AS $$
DECLARE
  stamp timestamptz;
BEGIN
  stamp := (to_jsonb(OLD) ->> TG_ARGV[0])::timestamptz;
  IF stamp >= now() - interval '30 days' THEN
    RAISE EXCEPTION '% rows younger than 30 days cannot be deleted', TG_TABLE_NAME;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS server_faults_retention_floor ON server_faults;
CREATE TRIGGER server_faults_retention_floor BEFORE DELETE ON server_faults
  FOR EACH ROW EXECUTE FUNCTION server_faults_retention_floor('occurred_at');

-- The suppression row IS a counter, so it may be updated (by the flush upsert);
-- only its deletion is floored.
DROP TRIGGER IF EXISTS server_fault_suppressions_retention_floor ON server_fault_suppressions;
CREATE TRIGGER server_fault_suppressions_retention_floor BEFORE DELETE ON server_fault_suppressions
  FOR EACH ROW EXECUTE FUNCTION server_faults_retention_floor('minute');
