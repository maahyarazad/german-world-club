-- The transactional counter primitive (FR-043).
--
-- Business quotas are NOT rate limits. An invitation quota, a coupon
-- redemption count, event capacity, and the per-account stored-byte quota are
-- correctness-critical: they must survive a Redis flush, be auditable, be
-- reportable to staff, and never be exceeded by racing two requests. The rate
-- limiter offers none of those guarantees, which is why this lives in
-- PostgreSQL and why the two mechanisms are kept apart
-- (see config/rate-limits.js).
--
-- One row per (scope, subject). `limit_value IS NULL` means unbounded, which is
-- distinct from a limit of zero — the difference between "no ceiling
-- configured" and "may not do this at all".
CREATE TABLE IF NOT EXISTS counters (
  scope        text        NOT NULL,
  subject      text        NOT NULL,
  used         bigint      NOT NULL DEFAULT 0 CHECK (used >= 0),
  limit_value  bigint      CHECK (limit_value IS NULL OR limit_value >= 0),
  -- Set when the counter is periodic (a monthly invitation quota, say). NULL
  -- for a cumulative counter such as stored bytes, which only moves when the
  -- underlying resource is released.
  window_start timestamptz,
  window_ends  timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, subject),
  -- A counter must not sit above its own ceiling. The reservation helper takes
  -- a row lock and checks before incrementing, so crossing this constraint
  -- means a write bypassed the helper — which is exactly when we want to know.
  CONSTRAINT counters_within_limit CHECK (limit_value IS NULL OR used <= limit_value),
  CONSTRAINT counters_window_is_whole CHECK ((window_start IS NULL) = (window_ends IS NULL))
);

CREATE INDEX IF NOT EXISTS counters_window_idx ON counters (window_ends) WHERE window_ends IS NOT NULL;
