-- Legacy URL preservation (FR-029, §12.12).
--
-- "URL stability is an asset": indexed URLs from the previous system carry
-- accumulated SEO equity, so the rebuild preserves them or permanently
-- redirects them. The mechanism and its tests ship now; the table is populated
-- when the club supplies its legacy URL inventory (plan.md Risk 5).
CREATE TABLE IF NOT EXISTS legacy_redirects (
  -- Normalised on write: lowercase, no trailing slash, no query string.
  legacy_path text PRIMARY KEY,
  target_path text NOT NULL,
  status      smallint NOT NULL DEFAULT 301 CHECK (status IN (301, 410)),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT legacy_path_is_normalised
    CHECK (legacy_path = lower(legacy_path) AND legacy_path NOT LIKE '%?%'
           AND (legacy_path = '/' OR legacy_path NOT LIKE '%/')),
  -- A 410 has no destination; a 301 must have one.
  CONSTRAINT target_matches_status
    CHECK ((status = 410) OR (length(btrim(target_path)) > 0))
);
