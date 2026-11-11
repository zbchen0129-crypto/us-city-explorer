CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE IF NOT EXISTS city_imports (
  sha256 text PRIMARY KEY, source text NOT NULL, retrieved_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(), record_count integer NOT NULL
);
CREATE TABLE IF NOT EXISTS cities (
  id bigint PRIMARY KEY, name text NOT NULL, state text NOT NULL,
  population bigint NOT NULL CHECK (population >= 0),
  latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  location geometry(Point,4326) NOT NULL,
  source_version text NOT NULL REFERENCES city_imports(sha256)
);
CREATE INDEX IF NOT EXISTS cities_name_idx ON cities (lower(name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS cities_state_idx ON cities (state);
CREATE INDEX IF NOT EXISTS cities_location_idx ON cities USING gist(location);
CREATE INDEX IF NOT EXISTS cities_geography_idx ON cities USING gist((location::geography));
