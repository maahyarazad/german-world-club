-- Scheduled jobs (data-model.md §5, FR-051).
--
-- §11 makes scheduled jobs admin-managed entities whose every run is logged.
-- Two properties carry the weight:
--
--  1. `enabled` is a row, not a deploy. Staff can stop a misbehaving job
--     without waiting for an engineer, which is the §11 requirement.
--  2. A run row is written when the job STARTS, not when it finishes. A crash
--     therefore leaves `finished_at` NULL rather than leaving no trace at all —
--     the difference between "this job died last Tuesday" and silence.
CREATE TABLE IF NOT EXISTS job_definitions (
  name         text        PRIMARY KEY,
  -- A cron expression, interpreted by croner.
  schedule     text        NOT NULL,
  enabled      boolean     NOT NULL DEFAULT true,
  description  text,
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_runs (
  id              bigserial   PRIMARY KEY,
  job_name        text        NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  -- NULL means still running, or the process died mid-run. Both are states an
  -- operator needs to be able to see; a job that reports success it never
  -- achieved is worse than one that reports nothing.
  finished_at     timestamptz,
  outcome         text        CHECK (outcome IN ('success', 'failure', 'skipped')),
  error           text,
  items_processed integer,
  -- A finished run must say how it went, and an unfinished one must not.
  CONSTRAINT job_runs_outcome_matches_finish
    CHECK ((finished_at IS NULL) = (outcome IS NULL))
);

CREATE INDEX IF NOT EXISTS job_runs_name_idx    ON job_runs (job_name, started_at DESC);
CREATE INDEX IF NOT EXISTS job_runs_unfinished_idx ON job_runs (started_at) WHERE finished_at IS NULL;
