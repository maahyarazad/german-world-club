-- Threads: the member post feed that replaces the forum (§7, feature 009).
--
-- Posts, nested replies, likes, reposts and follows. Moderation is global and
-- staff-only (§8), so there are no categories and no per-category moderators.
--
-- Counts (likes, replies, reposts) are computed, not stored. A denormalised
-- counter is one more thing a moderation action has to remember to fix, and a
-- feed page is twenty rows — the indexed counts cost less than the drift.

DO $$ BEGIN
  -- hidden: staff, reversible. removed: staff, final. deleted: the author, final.
  CREATE TYPE thread_post_state AS ENUM ('visible', 'hidden', 'removed', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS thread_posts (
  id               uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  -- RESTRICT: members are never deleted, only transitioned (§12 rule 4).
  author_id        uuid              NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  body             text              NOT NULL,
  -- The post this answers, and the top of the conversation it belongs to. Both
  -- or neither: a reply always knows its root, so the thread view is one
  -- indexed lookup rather than a recursive walk.
  reply_to_id      uuid              REFERENCES thread_posts (id) ON DELETE RESTRICT,
  root_id          uuid              REFERENCES thread_posts (id) ON DELETE RESTRICT,
  state            thread_post_state NOT NULL DEFAULT 'visible',
  state_reason     text,
  state_changed_at timestamptz       NOT NULL DEFAULT now(),
  state_changed_by uuid              REFERENCES admin_users (id) ON DELETE SET NULL,
  created_at       timestamptz       NOT NULL DEFAULT now(),

  CONSTRAINT thread_posts_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 500),
  CONSTRAINT thread_posts_reply_knows_root CHECK ((reply_to_id IS NULL) = (root_id IS NULL)),
  -- Staff moderate with a reason, every time — the same rule the marketplace
  -- follows, and the reason is what the audit entry and the member both see.
  CONSTRAINT thread_posts_moderation_has_reason
    CHECK (state NOT IN ('hidden', 'removed') OR length(btrim(coalesce(state_reason, ''))) > 0)
);

CREATE INDEX IF NOT EXISTS thread_posts_top_level_idx
  ON thread_posts (created_at DESC, id DESC) WHERE reply_to_id IS NULL;
CREATE INDEX IF NOT EXISTS thread_posts_author_idx  ON thread_posts (author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS thread_posts_replies_idx ON thread_posts (reply_to_id, created_at);

-- Removed and deleted are final. Staff moderate, they do not resurrect: a
-- post the author deleted coming back would be staff publishing in a member's
-- name.
CREATE OR REPLACE FUNCTION thread_posts_state_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.state IN ('removed', 'deleted') AND NEW.state IS DISTINCT FROM OLD.state THEN
    RAISE EXCEPTION 'thread post % is %, which is final', OLD.id, OLD.state;
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    -- Nobody edits a post after the fact, staff included (§8: staff moderate,
    -- they do not rewrite).
    RAISE EXCEPTION 'thread posts are not edited after publication';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    NEW.state_changed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS thread_posts_guard ON thread_posts;
CREATE TRIGGER thread_posts_guard BEFORE UPDATE ON thread_posts
  FOR EACH ROW EXECUTE FUNCTION thread_posts_state_guard();

CREATE TABLE IF NOT EXISTS thread_likes (
  post_id    uuid        NOT NULL REFERENCES thread_posts (id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One like per member per post, as a key: a double tap is a no-op, not two.
  PRIMARY KEY (post_id, member_id)
);

CREATE TABLE IF NOT EXISTS thread_reposts (
  post_id    uuid        NOT NULL REFERENCES thread_posts (id) ON DELETE CASCADE,
  member_id  uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, member_id)
);

CREATE INDEX IF NOT EXISTS thread_reposts_member_idx ON thread_reposts (member_id, created_at DESC);

-- Following shapes the feed (§7). Directed, unlike §7's contacts, which are
-- mutual and confirmed — following somebody needs nobody's consent, so it is a
-- different relation and not a contact state.
CREATE TABLE IF NOT EXISTS member_follows (
  follower_id uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  followee_id uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CONSTRAINT member_follows_not_self CHECK (follower_id <> followee_id)
);

CREATE INDEX IF NOT EXISTS member_follows_followee_idx ON member_follows (followee_id);

CREATE TABLE IF NOT EXISTS thread_reports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id         uuid        NOT NULL REFERENCES thread_posts (id) ON DELETE CASCADE,
  reporter_id     uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  reason          text        NOT NULL,
  state           text        NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'upheld', 'dismissed')),
  resolution_note text,
  resolved_by     uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- One report per member per post: a second one adds no information and
  -- would let one member inflate a queue.
  UNIQUE (post_id, reporter_id),
  CONSTRAINT thread_reports_resolution_complete
    CHECK ((state = 'open') = (resolved_at IS NULL))
);

CREATE INDEX IF NOT EXISTS thread_reports_open_idx ON thread_reports (created_at) WHERE state = 'open';
