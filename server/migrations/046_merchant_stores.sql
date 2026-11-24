-- Merchant stores, offer categories and the media sets (feature 035,
-- specs/035-merchant-store-offers/data-model.md).
--
-- A store is the merchant's storefront: one per merchant organisation, by
-- constraint. Name and logo stay in organisation_profiles (the only
-- member-visible projection of an organisation); the store adds only what a
-- storefront needs.

CREATE TABLE IF NOT EXISTS stores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE is the rule "each merchant has one store". The database holds it,
  -- not a check in application code, so two simultaneous creates cannot both win.
  organisation_id     uuid        NOT NULL UNIQUE,
  kind                organisation_kind NOT NULL DEFAULT 'merchant',
  description         text,
  -- The wide cover across the top. An image of about 16:9; the ratio needs the
  -- asset's dimensions, so the application checks it when the cover is set.
  cover_asset_id      uuid        REFERENCES assets (id) ON DELETE RESTRICT,
  opening_hours       text,
  -- Staff-only switch. A deactivated store and its offers vanish from every
  -- user surface but keep their data and history.
  active              boolean     NOT NULL DEFAULT true,
  deactivated_at      timestamptz,
  deactivated_by      uuid        REFERENCES admin_users (id) ON DELETE SET NULL,
  deactivation_reason text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  -- Doubles as the edit-conflict version, as admin_users.updated_at does.
  updated_at          timestamptz NOT NULL DEFAULT now(),

  -- Same composite-key trick as offers and merchant_locations: a store can only
  -- belong to an organisation whose kind is 'merchant'.
  CONSTRAINT stores_org_is_merchant
    FOREIGN KEY (organisation_id, kind) REFERENCES organisations (id, kind),
  CONSTRAINT stores_kind_fixed CHECK (kind = 'merchant'),
  CONSTRAINT stores_description_bounded CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT stores_hours_bounded CHECK (opening_hours IS NULL OR char_length(opening_hours) <= 500),
  -- A deactivation says when and why; an unexplained one is not auditable.
  CONSTRAINT stores_deactivation_recorded CHECK (
    active OR (deactivated_at IS NOT NULL AND deactivation_reason IS NOT NULL)
  ),
  -- Lets offers carry (store_id, organisation_id) as a composite foreign key,
  -- so an offer cannot name a store that belongs to another organisation.
  CONSTRAINT stores_id_org_unique UNIQUE (id, organisation_id)
);

-- A store is switched off, never deleted: history and redemptions refer to it.
CREATE OR REPLACE FUNCTION stores_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stores cannot be deleted; set active to false instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stores_refuse_delete ON stores;
CREATE TRIGGER stores_refuse_delete BEFORE DELETE ON stores
  FOR EACH ROW EXECUTE FUNCTION stores_no_delete();

-- The store gallery: at most 10 photos or videos, in order. The cover is NOT
-- part of this table, so choosing a cover does not use up one of the ten.
-- Same shape as marketplace_listing_media: the position bound makes an 11th
-- item unrepresentable, whatever the application checks.
CREATE TABLE IF NOT EXISTS store_media (
  store_id  uuid     NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: removing a link never removes bytes (another record
  -- may share the checksum); media/routes is the only place that deletes them.
  asset_id  uuid     NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  position  smallint NOT NULL,
  PRIMARY KEY (store_id, position),
  CONSTRAINT store_media_position_bounded CHECK (position BETWEEN 0 AND 9)
);

CREATE INDEX IF NOT EXISTS store_media_asset_idx ON store_media (asset_id);

CREATE TABLE IF NOT EXISTS offer_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- A stable code the clients can key on.
  slug       citext      NOT NULL UNIQUE,
  -- Staff-owned content, so both names are data, not server-emitted UI text.
  name_de    text        NOT NULL,
  name_en    text        NOT NULL,
  position   integer     NOT NULL DEFAULT 0,
  -- Hiding keeps the category on the offers that already have it; it only stops
  -- merchants choosing it for new ones.
  visible    boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_categories_slug_shape CHECK (slug ~ '^[a-z][a-z0-9-]{1,39}$'),
  CONSTRAINT offer_categories_names CHECK (
    char_length(btrim(name_de)) BETWEEN 1 AND 80 AND char_length(btrim(name_en)) BETWEEN 1 AND 80
  )
);

-- The generic starter set (spec FR-010). Inserted once; staff manage them after.
INSERT INTO offer_categories (slug, name_de, name_en, position) VALUES
  ('restaurants', 'Küche & Restaurants',    'Cuisine & Restaurants', 10),
  ('health',      'Gesundheit & Kliniken',  'Health & Clinics',      20),
  ('beauty',      'Beauty & Wellness',      'Beauty & Wellness',     30),
  ('shopping',    'Einkaufen',              'Shopping',              40),
  ('travel',      'Reisen & Freizeit',      'Travel & Leisure',      50),
  ('services',    'Dienstleistungen',       'Services',              60),
  ('education',   'Bildung',                'Education',             70),
  ('other',       'Sonstiges',              'Other',                 80)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- offers: store, category, limits, display order
-- ---------------------------------------------------------------------------

ALTER TABLE offers ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES offer_categories (id) ON DELETE RESTRICT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS store_id uuid;
-- NULL means unlimited per person. Default 1: a member price is normally a
-- once-per-person benefit, and a looser default would be the surprising one.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS per_person_limit integer DEFAULT 1;
-- The merchant's own display order within its store.
ALTER TABLE offers ADD COLUMN IF NOT EXISTS sort_position integer NOT NULL DEFAULT 0;

-- Offers that predate stores: give every organisation that has offers a store,
-- and file the offers under "other". Written to be safe to re-run.
INSERT INTO stores (organisation_id)
SELECT DISTINCT o.organisation_id FROM offers o
 WHERE NOT EXISTS (SELECT 1 FROM stores s WHERE s.organisation_id = o.organisation_id)
ON CONFLICT (organisation_id) DO NOTHING;

UPDATE offers o SET store_id = s.id
  FROM stores s
 WHERE s.organisation_id = o.organisation_id AND o.store_id IS NULL;

UPDATE offers SET category_id = (SELECT id FROM offer_categories WHERE slug = 'other')
 WHERE category_id IS NULL;

ALTER TABLE offers ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE offers ALTER COLUMN store_id SET NOT NULL;

DO $$ BEGIN
  -- An offer's store must belong to the offer's own organisation.
  ALTER TABLE offers ADD CONSTRAINT offers_store_matches_org
    FOREIGN KEY (store_id, organisation_id) REFERENCES stores (id, organisation_id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE offers ADD CONSTRAINT offers_per_person_limit_positive
    CHECK (per_person_limit IS NULL OR per_person_limit > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  -- A freebie or buy-one-get-one carries no discount figure; if it carries one
  -- it must make sense.
  ALTER TABLE offers ADD CONSTRAINT offers_gift_kinds_value
    CHECK (benefit_kind NOT IN ('freebie', 'bogo') OR benefit_value IS NULL OR benefit_value > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS offers_store_idx ON offers (store_id, sort_position);
CREATE INDEX IF NOT EXISTS offers_category_idx ON offers (category_id);

-- The offer gallery: at most 10 images or videos, in order; position 0 leads.
CREATE TABLE IF NOT EXISTS offer_media (
  offer_id  uuid     NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  asset_id  uuid     NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  position  smallint NOT NULL,
  PRIMARY KEY (offer_id, position),
  CONSTRAINT offer_media_position_bounded CHECK (position BETWEEN 0 AND 9)
);

CREATE INDEX IF NOT EXISTS offer_media_asset_idx ON offer_media (asset_id);

-- ---------------------------------------------------------------------------
-- updated_at is the edit-conflict version
-- ---------------------------------------------------------------------------
-- Stamped by the database on every UPDATE, so no code path can forget it and an
-- ad-hoc change moves the version too. Clients send back the version they read;
-- a stale one is a 409, and nobody's edit is silently overwritten.
CREATE OR REPLACE FUNCTION merchant_touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stores_touch ON stores;
CREATE TRIGGER stores_touch BEFORE UPDATE ON stores
  FOR EACH ROW EXECUTE FUNCTION merchant_touch_updated_at();

-- An offer's version does NOT move when only `remaining` changes. Every
-- redemption counts it down, and a merchant with the editor open would otherwise
-- find every save refused as stale because members were redeeming. Anything else
-- that changes moves the version, so a real edit still conflicts.
CREATE OR REPLACE FUNCTION offers_touch_updated_at() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(NEW) - 'remaining' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'remaining' - 'updated_at') THEN
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS offers_touch ON offers;
CREATE TRIGGER offers_touch BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION offers_touch_updated_at();
