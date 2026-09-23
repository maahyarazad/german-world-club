-- The mail outbox (resilience.md §2's declared fallback, made real).
--
-- integrations/mail.ts has always said mail is "enqueued, never sent inside the
-- request", but nothing enqueued anything: the reset-mail hook was optional-
-- chained against a decorator nobody registered. Onboarding cannot work that
-- way — an email code that is never sent is a registration nobody can finish —
-- so the queue exists now, and the `mail.deliver` job drains it.
--
-- `message_id` is the idempotency key integrations/mail.ts already derives from
-- (to, template, subjectKey). UNIQUE here means enqueueing the same message
-- twice is a no-op rather than a second email.
CREATE TABLE IF NOT EXISTS mail_outbox (
  id              bigserial   PRIMARY KEY,
  message_id      text        NOT NULL UNIQUE,
  to_address      citext      NOT NULL,
  template        text        NOT NULL,
  -- Cleared once delivered. A verification code has no business outliving its
  -- delivery in a table somebody might dump.
  variables       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  attempts        integer     NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mail_outbox_due_idx
  ON mail_outbox (next_attempt_at) WHERE sent_at IS NULL;
