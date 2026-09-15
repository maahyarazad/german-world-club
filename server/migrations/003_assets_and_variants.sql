-- Media originals and their delivered derivatives (Constitution Principle VI).
--
-- Shared: US3 writes these, US2 reads variants for og:image, US1 writes SEO
-- overrides that reference a share image. Placed in Foundational for that
-- reason.
CREATE TABLE IF NOT EXISTS assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           asset_kind  NOT NULL,
  -- Determined by content inspection, never by filename or client-declared
  -- type (FR-052).
  mime           text        NOT NULL,
  -- Content-addressed: two identical uploads store one copy, and a retry after
  -- a breaker recovery produces identical bytes at an identical key.
  checksum       bytea       NOT NULL UNIQUE,
  bytes          bigint      NOT NULL CHECK (bytes > 0),
  -- Probed synchronously, before the upload request completes, because §10.9's
  -- layout-shift requirement needs dimensions at first render (FR-055).
  width          integer     NOT NULL CHECK (width  > 0),
  height         integer     NOT NULL CHECK (height > 0),
  duration_ms    integer     CHECK (duration_ms IS NULL OR duration_ms > 0),
  -- §10.1 calls out galleries needing alt text.
  alt            text        NOT NULL CHECK (length(btrim(alt)) > 0),
  state          asset_state NOT NULL DEFAULT 'processing',
  failure_reason text,
  uploaded_by    uuid,
  uploader_kind  account_kind,
  storage_key    text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A stuck 'processing' row is a defect; a 'failed' row must say why (FR-059).
  CONSTRAINT assets_failure_reason_matches_state
    CHECK ((state = 'failed') = (failure_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS assets_state_idx    ON assets (state);
CREATE INDEX IF NOT EXISTS assets_uploader_idx ON assets (uploaded_by, uploader_kind);

CREATE TABLE IF NOT EXISTS asset_variants (
  asset_id    uuid          NOT NULL REFERENCES assets (id) ON DELETE CASCADE,
  variant     asset_variant NOT NULL,
  format      text          NOT NULL CHECK (format IN ('webp', 'png', 'jpeg', 'webm')),
  -- Actual output dimensions. Never larger than the source (FR-056) — the
  -- generator clamps, and derivatives.test.js asserts it.
  width       integer       NOT NULL CHECK (width  > 0),
  height      integer       NOT NULL CHECK (height > 0),
  bytes       bigint        NOT NULL CHECK (bytes > 0),
  storage_key text          NOT NULL,
  created_at  timestamptz   NOT NULL DEFAULT now(),
  PRIMARY KEY (asset_id, variant, format)
);
