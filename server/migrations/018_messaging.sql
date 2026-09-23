-- Messaging: persistence and the marketplace inquiry flow (feature 008, §7).
--
-- Its own migration because messaging outlives the marketplace. Threads,
-- contacts and system notifications all ride this substrate later; the
-- marketplace is simply its first caller.
--
-- Deliberately narrow. Group conversations, typing state, read receipts and
-- §7's notification opt-in matrix are NOT modelled here. A schema that
-- pretended to model them would be guessing at a feature nobody has specified,
-- and the guesses would be load-bearing by the time anyone corrected them.
--
-- The Technology & Security Baseline governs the ordering these tables serve:
-- "Real-time transport is additive — a message MUST be persisted before it is
-- delivered, so a dropped connection never loses data." Persistence is the
-- substrate; real-time is a delivery mechanism over it.

CREATE TABLE IF NOT EXISTS conversations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What the conversation is about, as a soft reference.
  --
  -- Not a hard FK to marketplace_listings: the next caller is threads, and a
  -- nullable listing_id column would have to be joined past by every future
  -- one. The trade is that the database cannot enforce this reference, so the
  -- application must — stated here rather than discovered later.
  subject_type      text        NOT NULL,
  subject_id        uuid,

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- Denormalised ORDERING key, not content. The inbox sorts on it, and the
  -- alternative is a correlated subquery per row on the hottest list query
  -- messaging has.
  last_message_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_subject_idx
  ON conversations (subject_type, subject_id);

CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id   uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  -- RESTRICT: members are never deleted, only transitioned (§12 rule 4).
  member_id         uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,

  -- Enough to compute an unread count without modelling read receipts, which
  -- belong to the real-time feature along with the transport that can set them.
  last_read_at      timestamptz,

  joined_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (conversation_id, member_id)
);

-- The inbox: "every conversation this member is in, newest activity first".
CREATE INDEX IF NOT EXISTS conversation_participants_member_idx
  ON conversation_participants (member_id);

CREATE TABLE IF NOT EXISTS messages (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid        NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id         uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,

  body              text        NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),

  -- A business rule living in a constraint, deliberately. Feature 007 Phase 6
  -- removes the Zod schema that also checks this; the constraint is what is
  -- left. See specs/007-typescript-migration/data-model.md §4.
  CONSTRAINT messages_body_bounded CHECK (length(btrim(body)) BETWEEN 1 AND 4000)
);

-- Keyset paging within a conversation, newest first.
CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON messages (conversation_id, created_at DESC, id DESC);

-- No delivered_at and no read_at, on purpose.
--
-- Delivery is on read in this feature. A column nothing writes is a promise the
-- schema cannot keep, and real-time will add them alongside the transport that
-- can actually set them.
