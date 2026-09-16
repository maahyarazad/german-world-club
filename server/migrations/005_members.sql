-- Member identity and access columns (data-model.md §1).
--
-- The profile model of BUSINESS_DESCRIPTION.md §2 — interests, privacy,
-- committees, orders — arrives with the member-profile feature. Only what
-- authentication and authorization need is here, so that feature extends this
-- table rather than restructuring it.
CREATE TABLE IF NOT EXISTS members (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- citext: uniqueness is business-critical. §3.1 forbids inviting an address
  -- that already belongs to a member, and case is not a distinguishing feature
  -- of an email address.
  email                   citext UNIQUE NOT NULL,
  -- NULL means the address is unconfirmed: the member is routed to profile
  -- completion and full access is withheld (FR-011).
  email_confirmed_at      timestamptz,
  -- argon2id. NULL means no usable password — sign-in is refused rather than
  -- falling back to anything. Legacy imports land here (FR-014).
  password_hash           text,
  password_reset_required boolean       NOT NULL DEFAULT false,
  status                  member_status NOT NULL DEFAULT 'active',
  status_changed_at       timestamptz   NOT NULL DEFAULT now(),
  -- E.164. FR-012's out-of-band code has nowhere to go without it, and §6.1
  -- makes the number a registration field verified before the email.
  mobile                  text,
  mobile_verified_at      timestamptz,
  last_login_at           timestamptz,
  -- §3.2's exempt ("hidden") members are excluded from auto-deactivation.
  inactivity_exempt       boolean NOT NULL DEFAULT false,
  -- §8: five or more bounces marks the address invalid; §9 also suppresses
  -- bulk sends to it.
  email_bounce_count      integer NOT NULL DEFAULT 0,
  email_suppressed        boolean NOT NULL DEFAULT false,
  -- Per-member permission flags (§7 marketplace posting, thread moderation).
  -- Members have no five-flag module matrix; these are the whole of their
  -- grantable capability set.
  permissions             jsonb   NOT NULL DEFAULT '{}'::jsonb,
  display_name            text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_is_e164 CHECK (mobile IS NULL OR mobile ~ '^\+[1-9][0-9]{6,14}$')
);

-- DELIBERATELY ABSENT: any column caching a membership package, tier or
-- discount. Entitlement is resolved from the card's validity window at point of
-- use (FR-013, §12.2). A denormalised tier column is the exact mechanism by
-- which a lapsed card would keep granting free events.

CREATE INDEX IF NOT EXISTS members_status_idx        ON members (status, status_changed_at);
CREATE INDEX IF NOT EXISTS members_last_login_idx    ON members (last_login_at) WHERE inactivity_exempt = false;

-- §12.4 and §3.2: "Full deletion of a member is deliberately not allowed."
-- A trigger rather than application code, so the rule survives an ad-hoc query
-- run against the database by hand — which is precisely when it matters.
CREATE OR REPLACE FUNCTION members_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'members are never deleted: end the membership with a status change instead (§12.4)';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_refuse_delete ON members;
CREATE TRIGGER members_refuse_delete BEFORE DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION members_no_delete();

-- `ended` is terminal (§3.2's state machine): no transition out of it exists.
CREATE OR REPLACE FUNCTION members_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ended' AND NEW.status <> 'ended' THEN
    RAISE EXCEPTION 'membership status "ended" is terminal (§3.2)';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS members_status_guard ON members;
CREATE TRIGGER members_status_guard BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION members_status_transition();

-- Single-use, expiring reset tokens (auth-api.md, data-model.md §1).
-- Consuming one revokes EVERY session for the account: the likely reason for a
-- reset is that the previous credential is compromised.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid         NOT NULL,
  account_kind account_kind NOT NULL,
  -- SHA-256 of a 256-bit random value. The plaintext is never stored, so a
  -- database read does not yield a usable reset link.
  token_hash   bytea        NOT NULL UNIQUE,
  issued_at    timestamptz  NOT NULL DEFAULT now(),
  expires_at   timestamptz  NOT NULL,
  consumed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_account_idx
  ON password_reset_tokens (account_id, account_kind) WHERE consumed_at IS NULL;
