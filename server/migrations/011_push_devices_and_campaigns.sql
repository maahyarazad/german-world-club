-- Push notifications (PUSH-NOTIFICATION-BLUEPRINT.md §2, adapted).
--
-- Three deliberate departures from the blueprint's own schema, each closing a
-- limitation it names in its text:
--
--  1. **One row per device, not per member.** The blueprint stores a single
--     token on the user record and admits that "a user logging in on a second
--     device overwrites the first device's token". Keyed on (member_id, token)
--     instead, so a member with a phone and a tablet receives on both. The
--     blueprint's own §2 recommends exactly this.
--  2. **No utf8mb4 dance.** That whole class of bug — a 4-byte emoji aborting
--     the INSERT *after* the push was delivered — is a MySQL collation problem.
--     PostgreSQL text is UTF-8 throughout, so titles and bodies carry emoji
--     without ceremony.
--  3. **Log ids are real uuids from the database.** The blueprint generates
--     them in Node because MySQL's LAST_INSERT_ID() does not work on a CHAR(36)
--     column, and warns that reading back "the newest row" attaches recipients
--     to the wrong parent under concurrent sends. `RETURNING id` makes the
--     problem disappear.

CREATE TYPE push_provider AS ENUM ('expo', 'fcm');
CREATE TYPE push_platform AS ENUM ('ios', 'android', 'web');
CREATE TYPE push_recipient_status AS ENUM ('delivered', 'failed');

-- One row per (member, device token).
CREATE TABLE IF NOT EXISTS push_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid          NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  -- An Expo token ("ExponentPushToken[…]") or a raw FCM token. Which one it is
  -- is decided by `provider`, never guessed: sending an Expo token through FCM
  -- hard-fails per token, and that failure looks like "push is broken for one
  -- cohort of users" rather than like a mismatch.
  token         text          NOT NULL,
  provider      push_provider NOT NULL DEFAULT 'fcm',
  platform      push_platform,
  -- The member's own opt-in. A device with a token but no consent is not a
  -- recipient; §9's messaging rules are opt-in, not opt-out.
  enabled       boolean       NOT NULL DEFAULT true,
  last_seen_at  timestamptz   NOT NULL DEFAULT now(),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  -- The same physical device re-registering must update its row, not add one.
  -- Tokens rotate on reinstall and OS restore, which is why registration is an
  -- upsert and why a stale row is pruned by the cleanup job rather than left to
  -- accumulate.
  UNIQUE (member_id, token)
);

CREATE INDEX IF NOT EXISTS push_devices_member_idx ON push_devices (member_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS push_devices_provider_idx ON push_devices (provider) WHERE enabled;

-- One row per send attempt, whether broadcast or test.
CREATE TABLE IF NOT EXISTS push_campaigns (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  title             text        NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 65),
  body              text        NOT NULL CHECK (length(btrim(body))  BETWEEN 1 AND 240),
  -- The deep-link payload (§5). Both are delivered to the client as strings.
  destination_type  text,
  destination_id    text,
  -- Captured AT SEND TIME so the log still reads correctly after the event or
  -- partner it pointed at is renamed or deleted.
  destination_label text,
  is_test           boolean     NOT NULL DEFAULT false,
  sent_by           uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  total_success     integer     NOT NULL DEFAULT 0,
  total_failure     integer     NOT NULL DEFAULT 0,
  expo_success      integer     NOT NULL DEFAULT 0,
  expo_failure      integer     NOT NULL DEFAULT 0,
  fcm_success       integer     NOT NULL DEFAULT 0,
  fcm_failure       integer     NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS push_campaigns_history_idx ON push_campaigns (is_test, sent_at DESC);

-- Per-token outcome, so a failure can be traced to a device.
CREATE TABLE IF NOT EXISTS push_campaign_recipients (
  campaign_id   uuid NOT NULL REFERENCES push_campaigns (id) ON DELETE CASCADE,
  device_id     uuid REFERENCES push_devices (id) ON DELETE SET NULL,
  member_id     uuid,
  token         text NOT NULL,
  provider      push_provider NOT NULL,
  platform      push_platform,
  status        push_recipient_status NOT NULL,
  error_message text,
  PRIMARY KEY (campaign_id, token)
);

CREATE INDEX IF NOT EXISTS push_campaign_recipients_failed_idx
  ON push_campaign_recipients (campaign_id) WHERE status = 'failed';

-- Staff-curated list used by the preview send, so a broadcast is always
-- rehearsed against a handful of real devices before it reaches the club.
CREATE TABLE IF NOT EXISTS push_test_recipients (
  member_id  uuid PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  added_by   uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
