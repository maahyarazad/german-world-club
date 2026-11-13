-- Message emails (feature 020, specs/020-listing-requests/research.md R3).
--
-- Every message about a listing emails the other participant — but a burst of
-- messages must be one email, and a message sent just after an email went out
-- must not be dropped either. This table is how: one row per recipient per
-- conversation, holding the outbox email still waiting to be sent (to merge
-- new messages into) and when the latest one was scheduled (so the next is
-- spaced 15 minutes after it).
--
-- Operational state, not history: rows are updated in place, and nothing here
-- is evidence of anything. The outbox row is the record that an email was sent.
--
-- `last_scheduled_for` is compared for EQUALITY with mail_outbox.next_attempt_at
-- to tell an email still waiting from one mail.deliver has picked up (its lease
-- moves next_attempt_at). Both are written by the same statement, never round-
-- tripped through the application, which would lose the microseconds.
CREATE TABLE IF NOT EXISTS message_mail_schedule (
  conversation_id    uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- RESTRICT: members are never deleted, only transitioned (§12 rule 4).
  member_id          uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  pending_message_id text,
  last_scheduled_for timestamptz,
  PRIMARY KEY (conversation_id, member_id)
);
