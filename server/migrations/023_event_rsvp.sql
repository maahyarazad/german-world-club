-- Cancelling an event registration (§4's mobile "attend / cancel" flow).
--
-- A cancellation is a timestamp, not a DELETE: the registration happened, the
-- attendance list staff print may already carry it, and an unpaid-follow-up
-- reminder may reference it. Re-registering after cancelling reuses the row,
-- which is what keeps UNIQUE (event_id, member_id) — "a member may register
-- only once per event" — true without an exception for cancellations.
ALTER TABLE event_registrations ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- The capacity guard, now aware of cancellations.
--
-- Two changes from 016. A cancelled registration holds no seat, so it neither
-- counts towards `taken` nor needs a check of its own. And the refusal now
-- carries a SQLSTATE and a constraint name, so the application can recognise
-- "event full" as a business outcome by what it is rather than by parsing an
-- English message.
CREATE OR REPLACE FUNCTION event_registrations_enforce_capacity() RETURNS trigger AS $$
DECLARE
  taken integer;
  limit_value integer;
BEGIN
  IF NEW.cancelled_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT capacity INTO limit_value FROM events WHERE id = NEW.event_id FOR UPDATE;

  SELECT COALESCE(sum(1 + guest_count + kids_free + kids_charged), 0) INTO taken
    FROM event_registrations
   WHERE event_id = NEW.event_id
     AND cancelled_at IS NULL
     AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF taken + 1 + NEW.guest_count + NEW.kids_free + NEW.kids_charged > limit_value THEN
    RAISE EXCEPTION 'event % is full (capacity %, would become %)',
      NEW.event_id, limit_value, taken + 1 + NEW.guest_count + NEW.kids_free + NEW.kids_charged
      USING ERRCODE = 'check_violation', CONSTRAINT = 'event_registrations_capacity';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
