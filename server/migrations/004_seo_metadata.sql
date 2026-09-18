-- Staff-editable SEO overrides (§10.8, FR-020, FR-021).
--
-- One row per public content record; absence means every value is derived from
-- the content itself. Derived values are the fallback, never the reverse.
CREATE TABLE IF NOT EXISTS seo_metadata (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_type          seo_record_type NOT NULL,
  record_id            uuid            NOT NULL,
  -- Human-readable, never a bare numeric id (FR-027). A collision would
  -- otherwise surface as a 500 on a paying partner's page.
  slug                 citext          NOT NULL,
  seo_title            text,
  meta_description     text,
  share_image_id       uuid REFERENCES assets (id) ON DELETE SET NULL,
  -- ANDed with the surface posture; the stricter wins (FR-025).
  indexable            boolean         NOT NULL DEFAULT true,
  language             text            NOT NULL DEFAULT 'de',
  -- Groups language variants, so hreflang alternates are generated reciprocally
  -- rather than written per page (a one-directional hreflang is ignored).
  translation_group_id uuid,
  published            boolean         NOT NULL DEFAULT false,
  created_at           timestamptz     NOT NULL DEFAULT now(),
  -- The real lastmod for the sitemap (FR-023), never the build time.
  updated_at           timestamptz     NOT NULL DEFAULT now(),
  UNIQUE (record_type, record_id),
  UNIQUE (record_type, slug)
);

CREATE INDEX IF NOT EXISTS seo_metadata_sitemap_idx
  ON seo_metadata (published, indexable, updated_at DESC);
CREATE INDEX IF NOT EXISTS seo_metadata_translation_idx
  ON seo_metadata (translation_group_id) WHERE translation_group_id IS NOT NULL;
