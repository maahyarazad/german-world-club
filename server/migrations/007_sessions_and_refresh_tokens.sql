-- Sessions and refresh-token lineage (data-model.md §3).
CREATE TABLE IF NOT EXISTS sessions (
  -- This id is the `sid` claim in the access token.
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Polymorphic by design: references members.id or admin_users.id per
  -- account_kind, with no foreign key. A single sessions table is what lets one
  -- authentication path serve both faces; the orphan-pruning job in US5 is the
  -- deliberate cost of that choice.
  account_id     uuid         NOT NULL,
  account_kind   account_kind NOT NULL,
  -- Mobile device binding (§6.1, §12.6). NULL for web.
  device_id      text,
  -- Recorded for the audit trail, never for an authorization decision.
  user_agent     text,
  ip_created     inet,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_reason text CHECK (
    revoked_reason IS NULL OR
    revoked_reason IN ('superseded', 'logout', 'staff_action', 'token_reuse', 'status_change', 'password_reset')
  ),
  CONSTRAINT revocation_is_complete
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- FR-004 / §12.7: ONE active session per account. This index *is* the rule.
--
-- A partial unique index turns two concurrent sign-ins into a constraint
-- violation the application handles deterministically, rather than a race whose
-- winner depends on timing. Sign-in therefore runs as one transaction: revoke
-- the active session, then insert the new one.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_session_per_account
  ON sessions (account_id, account_kind) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions (account_id, account_kind, created_at DESC);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid  NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  -- SHA-256 of a 256-bit random value. THE PLAINTEXT IS NEVER STORED: a
  -- database read must not yield a usable credential.
  token_hash  bytea NOT NULL UNIQUE,
  -- Rotation lineage. A replay is detected by finding a consumed ancestor, and
  -- the response is to delete the whole lineage.
  parent_id   uuid REFERENCES refresh_tokens (id) ON DELETE CASCADE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz
);

CREATE INDEX IF NOT EXISTS refresh_tokens_session_idx ON refresh_tokens (session_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx  ON refresh_tokens (expires_at) WHERE consumed_at IS NULL;
