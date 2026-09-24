-- Push notifications become an outbox (feature 011, specs/011-push-notifications/
-- data-model.md, research R1–R3, R5, R13).
--
-- Until now a campaign was sent inside the HTTP request and *then* written
-- down. That breaks persist-before-notify, puts two providers inside a request
-- budget that names neither, and cannot finish 5,000 devices before the
-- deadline. From here a request only inserts a row; a job delivers it.
--
-- The existing tables are evolved rather than replaced, so every campaign
-- already sent keeps its history:
--
--   push_campaigns            → push_notifications  (one row per notification)
--   push_campaign_recipients  → push_deliveries     (one row per device, with retry state)
--
-- The offer trigger is NOT here. It lives in 029 because the runner applies
-- each filename once: a database that had already run this file would never
-- receive a trigger added to it later.

-- ---------------------------------------------------------------------------
-- push_devices: one member per token, a language, and the session behind it
-- ---------------------------------------------------------------------------

-- A token addresses one physical phone. Keyed on (member_id, token), the same
-- phone signed into by a second member kept notifying the first (FR-004). Keep
-- the most recently seen row per token and drop the rest before tightening.
DELETE FROM push_devices older
 USING push_devices newer
 WHERE older.token = newer.token
   AND (newer.last_seen_at, newer.id) > (older.last_seen_at, older.id);

ALTER TABLE push_devices DROP CONSTRAINT IF EXISTS push_devices_member_id_token_key;
ALTER TABLE push_devices ADD CONSTRAINT push_devices_token_key UNIQUE (token);

ALTER TABLE push_devices
  -- Which text this phone receives (R5). The OS renders a push while the app
  -- is closed, so the app cannot translate it on arrival.
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'de',
  -- The session that registered the device. Sign-out deletes by it, so a phone
  -- signed out while offline still stops receiving (R3). No foreign key:
  -- sessions are pruned, and the device must not vanish with a pruned row.
  ADD COLUMN IF NOT EXISTS session_id uuid,
  -- 'unregistered' once a provider says the token is dead (R6). Distinct from
  -- `enabled`, which is the member's own choice and must survive re-registration.
  ADD COLUMN IF NOT EXISTS disabled_reason text;

DO $$ BEGIN
  ALTER TABLE push_devices ADD CONSTRAINT push_devices_locale_known CHECK (locale IN ('de', 'en'));
  ALTER TABLE push_devices ADD CONSTRAINT push_devices_disabled_reason_known
    CHECK (disabled_reason IS NULL OR disabled_reason IN ('unregistered'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS push_devices_session_idx ON push_devices (session_id) WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- member_push_preferences
-- ---------------------------------------------------------------------------

-- No row means both on (R13). "Everything off" is not a column here: it is the
-- device's `enabled`, or the OS permission, which already mean exactly that.
CREATE TABLE IF NOT EXISTS member_push_preferences (
  member_id  uuid        PRIMARY KEY REFERENCES members (id) ON DELETE CASCADE,
  offers     boolean     NOT NULL DEFAULT true,
  broadcasts boolean     NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- push_campaigns → push_notifications
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE push_kind   AS ENUM ('rehearsal', 'broadcast', 'offer');
  CREATE TYPE push_status AS ENUM ('queued', 'sending', 'done', 'partial', 'failed', 'cancelled');
  CREATE TYPE push_delivery_status AS ENUM ('pending', 'sending', 'sent', 'delivered', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE push_campaigns RENAME TO push_notifications;
ALTER TABLE push_notifications RENAME COLUMN title TO title_de;
ALTER TABLE push_notifications RENAME COLUMN body TO body_de;

-- The old column checks are replaced by named ones below. An offer
-- notification has no text until the dispatcher renders it, so NOT NULL goes.
ALTER TABLE push_notifications DROP CONSTRAINT IF EXISTS push_campaigns_title_check;
ALTER TABLE push_notifications DROP CONSTRAINT IF EXISTS push_campaigns_body_check;
ALTER TABLE push_notifications ALTER COLUMN title_de DROP NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN body_de DROP NOT NULL;

ALTER TABLE push_notifications
  ADD COLUMN kind            push_kind,
  ADD COLUMN status          push_status NOT NULL DEFAULT 'queued',
  -- Staff: the console's clientRef. Offer: 'offer:' || offer_id, which is what
  -- makes "announced at most once" (FR-022) a database fact (R2).
  ADD COLUMN idempotency_key text,
  -- sha256 of the canonical {kind, de, en, destination}. The same key with a
  -- different hash is a different message, refused with 409 rather than
  -- silently answered with the earlier one. NULL for offer and legacy rows.
  ADD COLUMN payload_hash    text,
  ADD COLUMN title_en        text,
  ADD COLUMN body_en         text,
  ADD COLUMN offer_id        uuid REFERENCES offers (id) ON DELETE RESTRICT,
  -- Which preference column applies: 'test' (none — test users agreed to be
  -- rehearsed on), 'broadcasts' or 'offers'.
  ADD COLUMN audience        text,
  -- An offer is held until it is valid (US4-3).
  ADD COLUMN not_before      timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN created_at      timestamptz,
  ADD COLUMN finished_at     timestamptz,
  -- The dispatcher's claim. A crashed dispatcher's lease simply runs out.
  ADD COLUMN lease_until     timestamptz;

-- Everything already recorded was sent inline and is therefore finished.
-- English falls back to the German text, which is what those phones received.
UPDATE push_notifications
   SET kind            = CASE WHEN is_test THEN 'rehearsal'::push_kind ELSE 'broadcast'::push_kind END,
       audience        = CASE WHEN is_test THEN 'test' ELSE 'broadcasts' END,
       status          = 'done',
       idempotency_key = 'legacy:' || id,
       title_en        = title_de,
       body_en         = body_de,
       created_at      = sent_at,
       not_before      = sent_at,
       finished_at     = sent_at;

-- The seed used 'all' as a destination type. It never was one: no screen
-- answers to it, and "everyone" is the audience, not the destination.
UPDATE push_notifications
   SET destination_type = NULL, destination_id = NULL
 WHERE destination_type IS NOT NULL
   AND destination_type NOT IN ('offer', 'listing', 'thread_post', 'event', 'partner', 'article');

-- `is_test` survives as a generated column so history queries written against
-- it keep working for a release. Its index goes with it.
DROP INDEX IF EXISTS push_campaigns_history_idx;
ALTER TABLE push_notifications DROP COLUMN is_test;
ALTER TABLE push_notifications ADD COLUMN is_test boolean GENERATED ALWAYS AS (kind = 'rehearsal') STORED;

-- `sent_at` used to be "when the request ran". Now it is "when the first batch
-- went out", which a queued notification does not have yet.
ALTER TABLE push_notifications ALTER COLUMN sent_at DROP NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN sent_at DROP DEFAULT;

ALTER TABLE push_notifications ALTER COLUMN kind SET NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN audience SET NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE push_notifications ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE push_notifications
  ADD CONSTRAINT push_notifications_idempotency_key UNIQUE (idempotency_key),
  ADD CONSTRAINT push_notifications_audience_known CHECK (audience IN ('test', 'broadcasts', 'offers')),
  ADD CONSTRAINT push_notifications_offer_iff_kind CHECK ((kind = 'offer') = (offer_id IS NOT NULL)),
  -- Staff write both languages (FR-014); only an offer may wait for the
  -- dispatcher to render its text.
  ADD CONSTRAINT push_notifications_text_present CHECK (
    kind = 'offer'
    OR (title_de IS NOT NULL AND body_de IS NOT NULL AND title_en IS NOT NULL AND body_en IS NOT NULL)
  ),
  ADD CONSTRAINT push_notifications_title_de_length CHECK (title_de IS NULL OR length(btrim(title_de)) BETWEEN 1 AND 65),
  ADD CONSTRAINT push_notifications_body_de_length  CHECK (body_de  IS NULL OR length(btrim(body_de))  BETWEEN 1 AND 240),
  ADD CONSTRAINT push_notifications_title_en_length CHECK (title_en IS NULL OR length(btrim(title_en)) BETWEEN 1 AND 65),
  ADD CONSTRAINT push_notifications_body_en_length  CHECK (body_en  IS NULL OR length(btrim(body_en))  BETWEEN 1 AND 240),
  ADD CONSTRAINT push_notifications_destination_known CHECK (
    destination_type IS NULL
    OR destination_type IN ('offer', 'listing', 'thread_post', 'event', 'partner', 'article')
  ),
  ADD CONSTRAINT push_notifications_finished_when_final CHECK (
    (status IN ('done', 'partial', 'failed', 'cancelled')) = (finished_at IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS push_notifications_history_idx ON push_notifications (kind, created_at DESC);
-- The sweep's whole working set: unfinished and due.
CREATE INDEX IF NOT EXISTS push_notifications_due_idx
  ON push_notifications (not_before) WHERE status IN ('queued', 'sending');

-- A finished notification stays finished. Without this, a slow dispatcher
-- whose lease ran out could write `sending` over a `done` another dispatcher
-- recorded, and the sweep would pick the notification up again.
CREATE OR REPLACE FUNCTION push_notifications_final_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('done', 'partial', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'push notification % is %, which is final', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS push_notifications_final_guard ON push_notifications;
CREATE TRIGGER push_notifications_final_guard
  BEFORE UPDATE OF status ON push_notifications
  FOR EACH ROW EXECUTE FUNCTION push_notifications_final_guard();

-- ---------------------------------------------------------------------------
-- push_campaign_recipients → push_deliveries
-- ---------------------------------------------------------------------------

ALTER TABLE push_campaign_recipients RENAME TO push_deliveries;
ALTER TABLE push_deliveries RENAME COLUMN campaign_id TO notification_id;

-- The old partial index compares against the old enum, so it must go before
-- the column changes type.
DROP INDEX IF EXISTS push_campaign_recipients_failed_idx;
ALTER TABLE push_deliveries DROP CONSTRAINT IF EXISTS push_campaign_recipients_pkey;

-- The old 'delivered' meant "the provider accepted it", which is now `sent`;
-- `delivered` is reserved for a receipt that confirms it.
ALTER TABLE push_deliveries
  ALTER COLUMN status TYPE push_delivery_status
  USING (CASE status::text WHEN 'delivered' THEN 'sent' ELSE 'failed' END)::push_delivery_status;
ALTER TABLE push_deliveries ALTER COLUMN status SET DEFAULT 'pending';
DROP TYPE IF EXISTS push_recipient_status;

-- A token does not need copying into history (FR-029): it is a credential for
-- addressing someone's phone, and the device row already holds it.
ALTER TABLE push_deliveries DROP COLUMN IF EXISTS token;

ALTER TABLE push_deliveries
  -- A surrogate key, because device_id goes NULL when a device is removed and
  -- a primary key cannot contain NULL. Uniqueness per device is the
  -- constraint below.
  ADD COLUMN id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN locale          text,
  ADD COLUMN attempts        integer     NOT NULL DEFAULT 0,
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  -- The Expo ticket id, which the receipts job redeems (R6).
  ADD COLUMN provider_ref    text,
  ADD COLUMN updated_at      timestamptz NOT NULL DEFAULT now();

ALTER TABLE push_deliveries
  ADD CONSTRAINT push_deliveries_pkey PRIMARY KEY (id),
  -- At most one delivery per device per notification (R2, FR-028). Two
  -- dispatchers materialising the same audience both hit this and one of them
  -- inserts nothing.
  ADD CONSTRAINT push_deliveries_once_per_device UNIQUE (notification_id, device_id),
  ADD CONSTRAINT push_deliveries_locale_known CHECK (locale IS NULL OR locale IN ('de', 'en')),
  ADD CONSTRAINT push_deliveries_attempts_bounded CHECK (attempts BETWEEN 0 AND 5),
  -- Error text comes from the provider. Bounded so a verbose provider cannot
  -- turn the history into a log store.
  ADD CONSTRAINT push_deliveries_error_bounded CHECK (error_message IS NULL OR length(error_message) <= 500);

CREATE INDEX IF NOT EXISTS push_deliveries_pending_idx
  ON push_deliveries (notification_id, next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS push_deliveries_receipts_idx
  ON push_deliveries (provider_ref) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS push_deliveries_sending_idx
  ON push_deliveries (updated_at) WHERE status = 'sending';
