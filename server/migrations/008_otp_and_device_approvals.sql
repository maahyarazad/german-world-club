-- Mobile second factor and device approval (data-model.md §3, §6.1, §6.2).
CREATE TABLE IF NOT EXISTS otp_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid         NOT NULL,
  account_kind account_kind NOT NULL,
  -- Hashed, not stored in the clear: a 4-digit code readable from a database
  -- dump is no second factor at all.
  code_hash    bytea        NOT NULL,
  -- Binds the challenge to the requesting device (§12.6), so a challenge
  -- cannot be probed from somewhere else.
  device_id    text         NOT NULL,
  purpose      text         NOT NULL CHECK (purpose IN ('login', 'device_approval')),
  -- A 4-digit code is only 10,000 possibilities. The ceiling and the 5-minute
  -- expiry — not the code's entropy — are what make it safe, and both are
  -- enforced here rather than in a client.
  attempts     integer      NOT NULL DEFAULT 0,
  expires_at   timestamptz  NOT NULL,
  consumed_at  timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_challenges_account_idx ON otp_challenges (account_id, account_kind)
  WHERE consumed_at IS NULL;
CREATE INDEX IF NOT EXISTS otp_challenges_expiry_idx  ON otp_challenges (expires_at);

-- §6.1: approval is tied to a device, and changing device invalidates it
-- (§12.6). Because the primary key includes device_id, a new device simply has
-- no row — the invalidation falls out of the key instead of needing a step
-- somebody has to remember.
CREATE TABLE IF NOT EXISTS device_approvals (
  member_id     uuid           NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  device_id     text           NOT NULL,
  state         approval_state NOT NULL DEFAULT 'pending',
  -- §6.1 requires a reason on denial, which is emailed to the applicant.
  denial_reason text,
  reviewed_by   uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, device_id),
  CONSTRAINT denial_states_its_reason
    CHECK (state <> 'denied' OR length(btrim(coalesce(denial_reason, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS device_approvals_pending_idx
  ON device_approvals (state, created_at) WHERE state = 'pending';
