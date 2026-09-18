-- The merchant offer and redemption domain (BUSINESS_DESCRIPTION.md §5,
-- feature 003 data-model.md §3).
--
-- Built to the business description rather than to the seeder's convenience:
-- §5 specifies the discount listing, the branch outlets, the coupon ledger and
-- the redemption counters. A table shaped to make demo data easy would be a
-- table feature 003's merchant portal then had to migrate.

DO $$ BEGIN
  CREATE TYPE offer_state  AS ENUM ('draft', 'pending', 'published', 'rejected', 'withdrawn');
  CREATE TYPE benefit_kind AS ENUM ('percentage', 'fixed_amount', 'member_price', 'value_add');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS merchant_locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid        NOT NULL,
  kind            organisation_kind NOT NULL DEFAULT 'merchant',
  label           text        NOT NULL,
  street          text,
  postal_code     text,
  city            text,
  country         text,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  opening_hours   text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  -- The composite key is the point: a location can only belong to an
  -- organisation whose kind is 'merchant'. Attaching one to a corporate partner
  -- is not something application code has to remember to refuse.
  CONSTRAINT merchant_locations_org_is_merchant
    FOREIGN KEY (organisation_id, kind) REFERENCES organisations (id, kind),
  CONSTRAINT merchant_locations_kind_fixed CHECK (kind = 'merchant')
);

CREATE INDEX IF NOT EXISTS merchant_locations_org_idx ON merchant_locations (organisation_id);

CREATE TABLE IF NOT EXISTS offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid        NOT NULL,
  kind                organisation_kind NOT NULL DEFAULT 'merchant',
  title               text        NOT NULL,
  description         text,
  -- §5's whole premise is that the advantage is *checkable*, so every part of
  -- it is a column rather than an optional blob.
  regular_price_cents integer,
  member_price_cents  integer,
  currency            char(3)     NOT NULL DEFAULT 'EUR',
  benefit_kind        benefit_kind NOT NULL,
  benefit_value       numeric(6, 2),
  valid_from          timestamptz NOT NULL,
  valid_until         timestamptz NOT NULL,
  conditions          text,
  state               offer_state NOT NULL DEFAULT 'draft',
  published_at        timestamptz,
  -- Decremented on redemption. NULL means unlimited.
  remaining           integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT offers_org_is_merchant
    FOREIGN KEY (organisation_id, kind) REFERENCES organisations (id, kind),
  CONSTRAINT offers_kind_fixed CHECK (kind = 'merchant'),
  CONSTRAINT offers_window_ordered CHECK (valid_until > valid_from),
  CONSTRAINT offers_percentage_sane CHECK (
    benefit_kind <> 'percentage' OR (benefit_value > 0 AND benefit_value <= 100)
  ),
  -- Merchant rule 1, from the design document: "echter Vorteil - nicht
  -- Normalpreis als Rabatt etikettieren". A real advantage, or no offer. This
  -- is the one business rule the mockups state twice, so it is a constraint
  -- rather than a convention a form could forget.
  CONSTRAINT offers_real_advantage CHECK (
    regular_price_cents IS NULL OR member_price_cents IS NULL
    OR member_price_cents < regular_price_cents
  ),
  CONSTRAINT offers_published_has_date CHECK (
    state <> 'published' OR published_at IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS offers_org_idx ON offers (organisation_id);
CREATE INDEX IF NOT EXISTS offers_visible_idx
  ON offers (state, valid_from, valid_until) WHERE state = 'published';

CREATE TABLE IF NOT EXISTS redemptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id               uuid        NOT NULL REFERENCES offers (id),
  member_id              uuid        NOT NULL REFERENCES members (id),
  redeemed_at            timestamptz NOT NULL DEFAULT now(),
  -- §5's generated reference number, and Principle IV's deterministic key: a
  -- retried redemption cannot become two.
  reference              text        NOT NULL UNIQUE,
  estimated_saving_cents integer
);

CREATE INDEX IF NOT EXISTS redemptions_offer_idx  ON redemptions (offer_id);
CREATE INDEX IF NOT EXISTS redemptions_member_idx ON redemptions (member_id);

CREATE TABLE IF NOT EXISTS redemption_feedback (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- One feedback per redemption; a second would be a second opinion on the
  -- same event, which the quality score has no way to weigh.
  redemption_id  uuid        NOT NULL UNIQUE REFERENCES redemptions (id),
  -- The three questions the mockup asks, verbatim: "Vorteil real?",
  -- "Preis korrekt?", "Service verlässlich?"
  benefit_real   boolean     NOT NULL,
  price_correct  boolean     NOT NULL,
  quality_rating smallint    NOT NULL,
  comment        text,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT redemption_feedback_rating_range CHECK (quality_rating BETWEEN 1 AND 5)
);
