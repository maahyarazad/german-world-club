-- Club events and registrations (BUSINESS_DESCRIPTION.md §4).
--
-- §4 is specific and this follows it: a capacity, a registration window split
-- into three pricing phases computed live rather than frozen at signup, one
-- registration per member, guests and two kid age bands, and an admin-controlled
-- state machine.

DO $$ BEGIN
  CREATE TYPE event_state          AS ENUM ('not_opened', 'open', 'closed', 'review');
  CREATE TYPE registration_payment AS ENUM ('online', 'door', 'invoice');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                citext      NOT NULL UNIQUE,
  title               text        NOT NULL,
  description         text,
  venue               text,
  city                text,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  starts_at           timestamptz NOT NULL,
  ends_at             timestamptz,
  -- Enforced across every registration source (§4). A limit checked in one
  -- writer is a race condition with extra steps, so it is a column the
  -- registration constraint below reads.
  capacity            integer     NOT NULL,
  -- The three phases. Which price applies is computed live against these dates
  -- rather than stored on the registration — §4 is explicit that it is "not
  -- stored as a fixed price at signup time".
  early_until         timestamptz,
  standard_until      timestamptz,
  registration_opens  timestamptz,
  registration_closes timestamptz,
  price_early_cents   integer,
  price_standard_cents integer,
  price_late_cents    integer,
  kids_price_cents    integer,
  max_kids            integer,
  currency            char(3)     NOT NULL DEFAULT 'EUR',
  state               event_state NOT NULL DEFAULT 'not_opened',
  -- Published after the event, and only then (§4).
  recap_published_at  timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT events_capacity_positive CHECK (capacity > 0),
  CONSTRAINT events_ends_after_starts CHECK (ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT events_window_ordered CHECK (
    registration_closes IS NULL OR registration_opens IS NULL
    OR registration_closes >= registration_opens
  ),
  CONSTRAINT events_phases_ordered CHECK (
    early_until IS NULL OR standard_until IS NULL OR standard_until >= early_until
  ),
  -- A recap is only allowed once the event has happened (§4).
  CONSTRAINT events_recap_after_event CHECK (
    recap_published_at IS NULL OR recap_published_at >= starts_at
  )
);

CREATE INDEX IF NOT EXISTS events_state_starts_idx ON events (state, starts_at);

CREATE TABLE IF NOT EXISTS event_registrations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid        NOT NULL REFERENCES events (id),
  member_id      uuid        NOT NULL REFERENCES members (id),
  guest_count    integer     NOT NULL DEFAULT 0,
  kids_free      integer     NOT NULL DEFAULT 0,   -- 0-5, free
  kids_charged   integer     NOT NULL DEFAULT 0,   -- 6-12, reduced rate
  payment_method registration_payment NOT NULL DEFAULT 'online',
  paid           boolean     NOT NULL DEFAULT false,
  amount_cents   integer,
  reminded_at    timestamptz,
  registered_at  timestamptz NOT NULL DEFAULT now(),

  -- §4: "A member may register only once per event." Stated as a constraint so
  -- a double submit cannot become a double booking.
  UNIQUE (event_id, member_id),
  CONSTRAINT event_registrations_counts_sane CHECK (
    guest_count >= 0 AND kids_free >= 0 AND kids_charged >= 0
  )
);

CREATE INDEX IF NOT EXISTS event_registrations_event_idx  ON event_registrations (event_id);
CREATE INDEX IF NOT EXISTS event_registrations_member_idx ON event_registrations (member_id);

-- Capacity, enforced in the database.
--
-- §4 requires it "across all registration sources (web and legacy mobile-app
-- guest tables combined)". A check in application code holds only for the
-- writer that remembers it, and two concurrent registrations for the last seat
-- would both pass it. The row lock here is what makes overselling impossible
-- rather than unlikely (Principle IV).
CREATE OR REPLACE FUNCTION event_registrations_enforce_capacity() RETURNS trigger AS $$
DECLARE
  taken integer;
  limit_value integer;
BEGIN
  SELECT capacity INTO limit_value FROM events WHERE id = NEW.event_id FOR UPDATE;

  SELECT COALESCE(sum(1 + guest_count + kids_free + kids_charged), 0) INTO taken
    FROM event_registrations
   WHERE event_id = NEW.event_id
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF taken + 1 + NEW.guest_count + NEW.kids_free + NEW.kids_charged > limit_value THEN
    RAISE EXCEPTION 'event % is full (capacity %, would become %)',
      NEW.event_id, limit_value, taken + 1 + NEW.guest_count + NEW.kids_free + NEW.kids_charged;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_registrations_capacity_guard ON event_registrations;
CREATE TRIGGER event_registrations_capacity_guard
  BEFORE INSERT OR UPDATE ON event_registrations
  FOR EACH ROW EXECUTE FUNCTION event_registrations_enforce_capacity();
