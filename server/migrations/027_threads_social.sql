-- Threads, completed (feature 010, specs/010-threads-profile).
--
-- Media on posts, quote posts, @mentions, blocks, mutes and the Activity
-- cursor. Counts and Activity itself stay computed, as 024 chose for counts:
-- a stored copy is one more thing every unlike, unfollow, hide and block
-- would have to remember to fix.

-- ---------------------------------------------------------------------------
-- Quote posts
-- ---------------------------------------------------------------------------

ALTER TABLE thread_posts
  ADD COLUMN IF NOT EXISTS quote_of_id uuid REFERENCES thread_posts (id) ON DELETE RESTRICT;

DO $$ BEGIN
  ALTER TABLE thread_posts ADD CONSTRAINT thread_posts_quote_not_self
    CHECK (quote_of_id IS NULL OR quote_of_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  -- A post answers something or quotes something, not both: a quote-reply
  -- would appear in two conversations at once and belong to neither.
  ALTER TABLE thread_posts ADD CONSTRAINT thread_posts_reply_or_quote
    CHECK (quote_of_id IS NULL OR reply_to_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS thread_posts_quotes_idx
  ON thread_posts (quote_of_id, created_at DESC) WHERE quote_of_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- A body is optional when there is media
-- ---------------------------------------------------------------------------

-- 024 required 1–500 characters. A media-only post is a real post on Threads,
-- so the length bound stays and the non-empty half moves to a check that can
-- see the media table.
ALTER TABLE thread_posts DROP CONSTRAINT IF EXISTS thread_posts_body_length;
ALTER TABLE thread_posts ADD CONSTRAINT thread_posts_body_length CHECK (char_length(btrim(body)) <= 500);

-- "Non-empty body OR at least one media item" spans two tables, so it cannot
-- be a row CHECK. A deferred constraint trigger runs at COMMIT, after the
-- media rows of the same transaction exist — so it holds for an ad-hoc INSERT
-- as much as for the API (Principle IV), and the API cannot commit a post
-- whose attachments all failed.
CREATE OR REPLACE FUNCTION thread_posts_has_content() RETURNS trigger AS $$
BEGIN
  IF length(btrim(NEW.body)) = 0
     AND NOT EXISTS (SELECT 1 FROM thread_post_media pm WHERE pm.post_id = NEW.id) THEN
    RAISE EXCEPTION 'thread post % has neither text nor media', NEW.id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'thread_posts_has_content';
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Everything about a post is immutable
-- ---------------------------------------------------------------------------

-- 024's guard, extended: what a post answers, quotes and who wrote it are part
-- of what was said, exactly like the body. Only state moves.
CREATE OR REPLACE FUNCTION thread_posts_state_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('removed', 'deleted') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'thread post % is %, which is final', OLD.id, OLD.state;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.author_id IS DISTINCT FROM OLD.author_id
     OR NEW.reply_to_id IS DISTINCT FROM OLD.reply_to_id
     OR NEW.root_id IS DISTINCT FROM OLD.root_id
     OR NEW.quote_of_id IS DISTINCT FROM OLD.quote_of_id THEN
    -- Nobody edits a post after the fact, staff included (§8: staff moderate,
    -- they do not rewrite).
    RAISE EXCEPTION 'thread posts are not edited after publication';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Media on posts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS thread_post_media (
  -- CASCADE is a declaration only: posts are never hard-deleted.
  post_id  uuid     NOT NULL REFERENCES thread_posts (id) ON DELETE CASCADE,
  -- RESTRICT: bytes are only removed by modules/media, and not while a post
  -- still shows them.
  asset_id uuid     NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  position smallint NOT NULL,
  PRIMARY KEY (post_id, position),
  -- The same photo twice in one post is a mistake, and unlike 008's galleries
  -- nothing stops this being a constraint: position stays the key.
  UNIQUE (post_id, asset_id),
  CONSTRAINT thread_post_media_position CHECK (position BETWEEN 0 AND 9)
);

CREATE INDEX IF NOT EXISTS thread_post_media_asset_idx ON thread_post_media (asset_id);

DROP TRIGGER IF EXISTS thread_posts_has_content ON thread_posts;
CREATE CONSTRAINT TRIGGER thread_posts_has_content
  AFTER INSERT ON thread_posts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION thread_posts_has_content();

-- Media is attached in the transaction that creates the post, and never
-- after (research R4). A later "attach" would be an edit.
--
-- Why `xmin` and not `created_at = now()`, which looks simpler: now() is the
-- transaction start, so the equality would hold only for a post created with
-- the default — and the demo seed stamps historical timestamps on purpose.
-- A row's xmin is the id of the transaction that wrote it, so comparing it to
-- the current transaction asks exactly "was this post written by me, now?".
-- The low 32 bits of txid_current() are that id. Callers must not create the
-- post inside a SAVEPOINT, whose rows carry a subtransaction id instead;
-- withTransaction() does not use savepoints.
CREATE OR REPLACE FUNCTION thread_post_media_guard() RETURNS trigger AS $$
DECLARE
  written_by text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    -- There is no application role to revoke a grant from on this platform,
    -- so immutability is a trigger — audit_log's mechanism.
    RAISE EXCEPTION 'post media is part of the post and is not changed after publication';
  END IF;
  SELECT p.xmin::text INTO written_by FROM thread_posts p WHERE p.id = NEW.post_id;
  IF written_by IS DISTINCT FROM (txid_current() % 4294967296)::text THEN
    RAISE EXCEPTION 'media can only be attached in the transaction that creates the post';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thread_post_media_guard ON thread_post_media;
CREATE TRIGGER thread_post_media_guard BEFORE INSERT OR UPDATE OR DELETE ON thread_post_media
  FOR EACH ROW EXECUTE FUNCTION thread_post_media_guard();

-- ---------------------------------------------------------------------------
-- Mentions
-- ---------------------------------------------------------------------------

-- Keyed by the member, not the string: a mention must survive the mentioned
-- member changing their handle. `handle_as_written` is the span in the
-- (immutable) body that a client links.
CREATE TABLE IF NOT EXISTS thread_post_mentions (
  post_id           uuid        NOT NULL REFERENCES thread_posts (id) ON DELETE CASCADE,
  member_id         uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  handle_as_written citext      NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, member_id)
);

CREATE INDEX IF NOT EXISTS thread_post_mentions_member_idx
  ON thread_post_mentions (member_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Blocks and mutes
-- ---------------------------------------------------------------------------

-- A block is visibility (both directions, enforced everywhere a post or a
-- profile is read); a mute is curation (the muter's feeds only). Different
-- rules, so different tables.
CREATE TABLE IF NOT EXISTS member_blocks (
  blocker_id uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  blocked_id uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT member_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE INDEX IF NOT EXISTS member_blocks_blocked_idx ON member_blocks (blocked_id);

CREATE TABLE IF NOT EXISTS member_mutes (
  muter_id   uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  muted_id   uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CONSTRAINT member_mutes_not_self CHECK (muter_id <> muted_id)
);

CREATE INDEX IF NOT EXISTS member_mutes_muted_idx ON member_mutes (muted_id);

-- ---------------------------------------------------------------------------
-- Activity cursor
-- ---------------------------------------------------------------------------

-- Activity is computed on read (research R8); all that is stored is where the
-- member stopped reading. The application only ever moves it forward.
CREATE TABLE IF NOT EXISTS member_activity_cursor (
  member_id uuid        PRIMARY KEY REFERENCES members (id) ON DELETE RESTRICT,
  seen_at   timestamptz NOT NULL
);
