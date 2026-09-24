-- Announce an offer when it is published (feature 011, US4, research R12).
--
-- Its own file rather than part of 028: the runner applies each filename once,
-- so a database that had already run 028 would never receive a trigger added
-- to that file afterwards (analysis U3). Written to be safe to re-run anyway.
--
-- **Why a trigger and not a route hook.** Offers are published from more than
-- one place — the demo seed, a psql session today, the merchant portal later —
-- and a notification queued by application code would follow only the paths
-- that remembered to queue it. Here the notification row commits or rolls back
-- with the publication itself, whoever publishes, and nothing is sent inside
-- that transaction (FR-021): the row is picked up by the `push.deliver` tick.
--
-- "Announced at most once" (FR-022) is the idempotency key, not this
-- function's bookkeeping: published → withdrawn → published inserts nothing
-- the second time, because 'offer:<id>' already exists.
--
-- The text is not written here. The dispatcher renders it from the offer's
-- current title and the merchant's public name when it sends, so an offer
-- renamed before `valid_from` goes out under its current name, and it cancels
-- the notification if the offer is no longer visible by then (FR-023).

CREATE OR REPLACE FUNCTION offers_queue_push() RETURNS trigger AS $$
BEGIN
  IF NEW.state <> 'published' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.state = 'published' THEN
    RETURN NULL;
  END IF;
  -- The demo seed inserts offers that are already published. Seeded history
  -- must not notify anyone — the consistent-history rule — so the seeder sets
  -- this for its own transaction only (SET LOCAL), and nothing else ever does.
  IF current_setting('gwc.suppress_offer_push', true) = 'on' THEN
    RETURN NULL;
  END IF;

  INSERT INTO push_notifications
    (kind, audience, offer_id, idempotency_key, not_before, status, destination_type, destination_id)
  VALUES
    ('offer', 'offers', NEW.id, 'offer:' || NEW.id, greatest(now(), NEW.valid_from), 'queued',
     'offer', NEW.id::text)
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS offers_queue_push ON offers;
CREATE TRIGGER offers_queue_push
  AFTER INSERT OR UPDATE OF state ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_queue_push();
