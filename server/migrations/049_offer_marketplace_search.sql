-- Text search over merchant offers and marketplace listings (feature 042).
--
-- A search is `title ILIKE '%word%' OR description ILIKE '%word%'` per word, ANDed
-- (server/src/db/text-search.ts). `ILIKE` with a leading wildcard cannot use a btree
-- index, so without these it is a sequential scan of every description (a listing's
-- body is up to 8,000 characters), which looks fine until the corpus grows. A trigram
-- GIN index answers it, and unlike full-text search it matches INSIDE a word, which a
-- German club needs: "helm" must find "Fahrradhelm" (research R11).
--
-- The extension is REQUIRED and there is deliberately no fallback here. A migration
-- that quietly skipped the indexes would ship a search that is slow only at scale;
-- failing to install is the louder, safer outcome. `pg_trgm` ships with PostgreSQL and
-- is a trusted extension, so the database owner can create it, as 001 does for citext.
--
-- Each index is PARTIAL on the live state. A draft, a withdrawn offer or a hidden listing
-- is never in the index, so it cannot be reached through it, and the index stays small.
-- Each predicate is a literal conjunct of the query's own WHERE (`VISIBLE_OFFER` contains
-- `o.state = 'published'`; marketplace browse filters `l.state = 'active'`), which is what
-- lets the planner use a partial index at all. A term of fewer than three characters has no
-- trigram to look up, so such a search is evaluated over the rows of the partial index only.
--
-- One transaction per file (db/migrate.ts), so no CONCURRENTLY; the tables are small and
-- a plain CREATE INDEX holds writes for well under a second.
--
-- Rollback: DROP INDEX the four. The extension may stay.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS offers_title_trgm_idx
  ON offers USING gin (title gin_trgm_ops) WHERE state = 'published';

CREATE INDEX IF NOT EXISTS offers_description_trgm_idx
  ON offers USING gin (description gin_trgm_ops) WHERE state = 'published';

CREATE INDEX IF NOT EXISTS listings_title_trgm_idx
  ON marketplace_listings USING gin (title gin_trgm_ops) WHERE state = 'active';

CREATE INDEX IF NOT EXISTS listings_body_trgm_idx
  ON marketplace_listings USING gin (body gin_trgm_ops) WHERE state = 'active';
