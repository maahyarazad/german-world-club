-- The country/city lists the profiling questionnaire offers (feature 013,
-- revision 4): the InterNations list supplied by the club, loaded from
-- server/data/internations-cities.json by `npm run -w server load:cities`.
--
-- Reference data, like gwc_cities: the migration only creates the table, and
-- the loader fills it. It covers 160 countries, so a member living elsewhere
-- types their city (the API says which countries are listed), and it omits
-- three of the seven emirates the club designates as GWC cities — the cities
-- endpoint therefore offers the union of both tables.
CREATE TABLE IF NOT EXISTS world_cities (
  country    char(2)     NOT NULL,
  city       text        NOT NULL,
  region     text        NOT NULL,
  is_capital boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_cities_country_is_iso CHECK (country ~ '^[A-Z]{2}$')
);

-- Tripoli exists in two countries, so the city alone is not the key. An
-- expression cannot be a primary key, hence a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS world_cities_country_city ON world_cities (country, lower(city));
