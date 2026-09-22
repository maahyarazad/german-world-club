-- Member marketplace / classifieds (BUSINESS_DESCRIPTION.md §7, feature 008).
--
-- §7 is specific and this follows it: four categories each with their own
-- structured fields, every listing an offer or a request, multiple media, a
-- configurable contact method, a per-member posting flag and terms acceptance.
--
-- Two things this is NOT:
--
--   * It is not the merchant offer system. `offers` (015_merchant_domain.sql)
--     is §5 — a commercial counterparty publishing a checkable discount with
--     redemption codes and terminal PINs. §5 is emphatic that a merchant is
--     not a member. Only members post here (FR-038).
--   * It is not a transaction. §7 describes a contact method, not a sale. A
--     listing ends in two members talking, which is what 018_messaging.sql is.

DO $$ BEGIN
  CREATE TYPE marketplace_category AS ENUM ('vehicle', 'property', 'job', 'general');
  CREATE TYPE marketplace_mode     AS ENUM ('offer', 'request');
  -- sold and filled are both terminal successes and both exist because they
  -- are not the same event: a vehicle sells, a job is filled. Distinguishing
  -- them is the only signal that the marketplace works.
  -- hidden is reachable only by moderation, and only from active. It is
  -- separate from withdrawn so the owner can see it was hidden rather than
  -- find it silently gone.
  CREATE TYPE marketplace_state    AS ENUM
    ('draft', 'active', 'sold', 'filled', 'withdrawn', 'expired', 'hidden');
  -- A preference, never a value. Gains entries when messaging grows; the
  -- server branches on each, which is why this is an enum and not a table.
  CREATE TYPE marketplace_contact  AS ENUM ('platform_message', 'email_relay', 'phone');
  CREATE TYPE report_state         AS ENUM ('open', 'upheld', 'dismissed');
  CREATE TYPE general_listing_kind AS ENUM ('product', 'service');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- The common table. The only one the unfiltered index reads.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id                uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT: members are never deleted, only transitioned (§12 rule 4).
  owner_id          uuid                  NOT NULL REFERENCES members (id) ON DELETE RESTRICT,

  -- Decides which detail table holds this listing's fields.
  category          marketplace_category  NOT NULL,
  mode              marketplace_mode      NOT NULL,

  title             text                  NOT NULL,
  -- Stored raw so partner auto-linking (§2) stays possible later.
  body              text                  NOT NULL,

  state             marketplace_state     NOT NULL DEFAULT 'draft',
  contact_method    marketplace_contact   NOT NULL DEFAULT 'platform_message',

  -- Denormalised on purpose: it records what they agreed to THEN, which a join
  -- to the latest acceptance would silently rewrite when the terms change.
  terms_version     text                  NOT NULL,

  created_at        timestamptz           NOT NULL DEFAULT now(),
  updated_at        timestamptz           NOT NULL DEFAULT now(),
  published_at      timestamptz,

  -- NULL means UNLIMITED — a first-class choice, not a missing value (FR-028).
  -- The expiry job's predicate must therefore be
  --   expires_at IS NOT NULL AND expires_at <= now()
  -- Both halves. Without the null check it silently expires every unlimited
  -- listing, and a happy-path test would not notice.
  expires_at        timestamptz,

  -- Feature 005's consistent-history rule needs this: an entry only where a
  -- seeded fact implies one, at that fact's own timestamp.
  state_changed_at  timestamptz           NOT NULL DEFAULT now(),

  -- An active listing has a publication time, or the index sorts on null.
  CONSTRAINT listings_active_is_published
    CHECK (state <> 'active' OR published_at IS NOT NULL),

  -- An expiry already past at publication is a data-entry error, not a listing.
  CONSTRAINT listings_expiry_after_publication
    CHECK (expires_at IS NULL OR published_at IS NULL OR expires_at > published_at),

  -- Business rules in constraints, deliberately: feature 007 Phase 6 removes
  -- the Zod schemas that also check these, and the constraint is what is left.
  CONSTRAINT listings_title_bounded CHECK (length(btrim(title)) BETWEEN 3 AND 140),
  CONSTRAINT listings_body_bounded  CHECK (length(btrim(body))  BETWEEN 10 AND 8000)
);

-- The keyset index query (research.md R8). Partial, so it indexes only what
-- that query reads.
CREATE INDEX IF NOT EXISTS listings_active_idx
  ON marketplace_listings (created_at DESC, id DESC) WHERE state = 'active';

-- The category filter, which is the common case.
CREATE INDEX IF NOT EXISTS listings_category_active_idx
  ON marketplace_listings (category, created_at DESC, id DESC) WHERE state = 'active';

-- "My listings", which must include hidden and withdrawn ones.
CREATE INDEX IF NOT EXISTS listings_owner_idx
  ON marketplace_listings (owner_id, state_changed_at DESC);

-- The expiry job's scan.
CREATE INDEX IF NOT EXISTS listings_expiring_idx
  ON marketplace_listings (expires_at) WHERE expires_at IS NOT NULL AND state = 'active';

-- ---------------------------------------------------------------------------
-- Detail tables — one per category, one-to-one, PK *and* FK on listing_id.
--
-- A category change deletes the old detail row and inserts a new one, which is
-- why fields that no longer apply cannot linger: the row holding them is gone.
--
-- Money is integer minor units plus a currency, never a float. The platform
-- already divides by 100 in exactly one place (client/src/lib/format.ts), and
-- a second conversion site is how the two drift.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_vehicle_details (
  listing_id      uuid    PRIMARY KEY REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  make            citext  NOT NULL,
  model           citext,
  year            smallint,
  mileage_km      integer,
  price_minor     bigint,
  currency        char(3) NOT NULL DEFAULT 'EUR',
  fuel            text,
  transmission    text,
  body_type       text,
  condition       text,
  CONSTRAINT vehicle_price_non_negative CHECK (price_minor IS NULL OR price_minor >= 0),
  CONSTRAINT vehicle_year_plausible     CHECK (year IS NULL OR year BETWEEN 1900 AND 2100)
);

CREATE INDEX IF NOT EXISTS vehicle_price_idx ON marketplace_vehicle_details (price_minor);
CREATE INDEX IF NOT EXISTS vehicle_make_idx  ON marketplace_vehicle_details (make);

CREATE TABLE IF NOT EXISTS marketplace_property_details (
  listing_id      uuid          PRIMARY KEY REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  -- NOT the same axis as listings.mode: a *request* to *rent* is a coherent
  -- listing, and collapsing the two would make it unexpressible.
  deal            text          NOT NULL CHECK (deal IN ('rent', 'sale')),
  -- Half-rooms are a real German convention, so numeric rather than integer.
  rooms           numeric(4, 1),
  size_sqm        numeric(8, 2),
  price_minor     bigint,
  currency        char(3)       NOT NULL DEFAULT 'EUR',
  city            citext,
  postal_code     citext,
  available_from  date,
  CONSTRAINT property_price_non_negative CHECK (price_minor IS NULL OR price_minor >= 0)
);

CREATE INDEX IF NOT EXISTS property_deal_city_idx ON marketplace_property_details (deal, city);
CREATE INDEX IF NOT EXISTS property_rooms_idx     ON marketplace_property_details (rooms);
CREATE INDEX IF NOT EXISTS property_price_idx     ON marketplace_property_details (price_minor);

CREATE TABLE IF NOT EXISTS marketplace_job_details (
  listing_id        uuid    PRIMARY KEY REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  employment_type   text,
  seniority         text,
  department        text,
  city              citext,
  remote            text    CHECK (remote IS NULL OR remote IN ('onsite', 'hybrid', 'remote')),
  salary_min_minor  bigint,
  salary_max_minor  bigint,
  currency          char(3) NOT NULL DEFAULT 'EUR',
  CONSTRAINT job_salary_ordered
    CHECK (salary_min_minor IS NULL OR salary_max_minor IS NULL
           OR salary_max_minor >= salary_min_minor)
);

CREATE INDEX IF NOT EXISTS job_city_seniority_idx ON marketplace_job_details (city, seniority);
CREATE INDEX IF NOT EXISTS job_salary_idx
  ON marketplace_job_details (salary_min_minor, salary_max_minor);

-- Deliberately the loosest of the four.
--
-- `general` exists so an arbitrary product or service has somewhere to go, and
-- over-structuring it would defeat that — a member selling a bicycle repair
-- service should not be asked for a mileage. It still gets a detail table, so
-- every category has exactly one detail row rather than general being a
-- special case with none.
CREATE TABLE IF NOT EXISTS marketplace_general_details (
  listing_id    uuid                  PRIMARY KEY REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  -- The one discriminator worth keeping: a service priced per hour and a
  -- product priced once read differently in an index.
  kind          general_listing_kind  NOT NULL,
  price_minor   bigint,
  currency      char(3)               NOT NULL DEFAULT 'EUR',
  condition     text,
  CONSTRAINT general_price_non_negative CHECK (price_minor IS NULL OR price_minor >= 0)
);

CREATE INDEX IF NOT EXISTS general_kind_price_idx ON marketplace_general_details (kind, price_minor);

-- ---------------------------------------------------------------------------
-- Vehicle features: a catalogue plus a join table, not ~40 boolean columns.
--
-- §7 says "~40" and the tilde is the argument: the set will change. Forty
-- columns is a migration every time the club adds "roof box". This costs one
-- extra table and buys three things — no migration per checkbox, a foreign key
-- that makes an unknown feature impossible rather than unlikely, and a
-- catalogue that staff can edit under the permission system rather than
-- needing engineering (Workflow section).
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vehicle_features (
  id          smallint    PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
  -- Stable identifier, never shown. Labels are client-side i18n keyed by this:
  -- the server emits no localised text, and tests/ops/no-server-localisation
  -- asserts no response body varies with Accept-Language.
  key         citext      NOT NULL UNIQUE,
  -- comfort / safety / media — the compose form's sections.
  grouping    text        NOT NULL,
  -- Display order is a business decision, not alphabetical.
  position    integer     NOT NULL DEFAULT 0,
  -- Soft-retire, never delete. Removing a row would orphan or cascade away the
  -- fact that a listing had the feature. A retired feature stops being offered
  -- on new listings and still renders on old ones.
  retired_at  timestamptz
);

CREATE INDEX IF NOT EXISTS vehicle_features_live_idx
  ON vehicle_features (grouping, position) WHERE retired_at IS NULL;

CREATE TABLE IF NOT EXISTS marketplace_vehicle_features (
  listing_id  uuid      NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  feature_id  smallint  NOT NULL REFERENCES vehicle_features (id) ON DELETE RESTRICT,
  PRIMARY KEY (listing_id, feature_id)
);

-- "Listings having this feature". "Has all of these" is
--   GROUP BY listing_id HAVING count(*) = $n
CREATE INDEX IF NOT EXISTS vehicle_features_listing_idx
  ON marketplace_vehicle_features (feature_id, listing_id);

-- ---------------------------------------------------------------------------
-- Media. Named media, not photos: a listing may carry one photo, several
-- photos, or a video (FR-039). The pipeline already handles both kinds.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_listing_media (
  listing_id  uuid      NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  -- RESTRICT, *not* CASCADE. Deleting a listing removes these links, never the
  -- bytes: another listing may share the checksum, and media/routes is the only
  -- place that decides whether bytes go.
  asset_id    uuid      NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  -- Explicit, because the FIRST item represents the listing in the index — and
  -- for a video that means its poster variant, so a browse page never
  -- autoplays and never waits on a transcode (FR-040).
  position    smallint  NOT NULL DEFAULT 0,
  PRIMARY KEY (listing_id, position),
  CONSTRAINT listing_media_position_bounded CHECK (position BETWEEN 0 AND 19)
);

CREATE INDEX IF NOT EXISTS listing_media_asset_idx ON marketplace_listing_media (asset_id);

-- ---------------------------------------------------------------------------
-- Reports and terms acceptance
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS marketplace_reports (
  id            uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid          NOT NULL REFERENCES marketplace_listings (id) ON DELETE CASCADE,
  reporter_id   uuid          NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  reason        text          NOT NULL,
  state         report_state  NOT NULL DEFAULT 'open',
  created_at    timestamptz   NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   uuid          REFERENCES admin_users (id) ON DELETE RESTRICT,
  CONSTRAINT report_reason_bounded CHECK (length(btrim(reason)) BETWEEN 3 AND 2000)
);

-- One OPEN report per member per listing, so a single complainant cannot flood
-- the queue. Reports are evidence and are never deleted; dismissed is a state.
CREATE UNIQUE INDEX IF NOT EXISTS reports_one_open_per_reporter
  ON marketplace_reports (listing_id, reporter_id) WHERE state = 'open';

CREATE INDEX IF NOT EXISTS reports_queue_idx
  ON marketplace_reports (created_at DESC) WHERE state = 'open';

-- Append-only. A member who accepts v2 keeps their v1 row: it is the record of
-- what they agreed to when they posted their earlier listings, which is why
-- marketplace_listings.terms_version is denormalised rather than joined.
CREATE TABLE IF NOT EXISTS marketplace_terms_acceptances (
  member_id    uuid        NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  version      text        NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, version)
);
