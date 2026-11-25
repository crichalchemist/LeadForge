-- Provenance of enrichment facts (ADR 031). Discovery decided for each business whether Google's
-- candidate was the business it asked for, then kept only the verdict: the name score and distance
-- behind it were discarded, and Google's own website and phone were merged with Overture's before
-- storage. This keeps them, one row per business, so the CRM can say which source supplied each fact.
-- license_name is the city's name for the business, which `name` loses when Google renames it.
ALTER TABLE businesses ADD COLUMN license_name TEXT;

CREATE TABLE google_matches (
  business_id  TEXT PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN
                 ('matched', 'rejected_distance', 'rejected_name', 'no_candidate', 'unavailable')),
  place_id     TEXT,
  matched_name TEXT,
  score        REAL,
  distance_m   INTEGER,
  website      TEXT,
  phone        TEXT,
  looked_up_at TEXT NOT NULL
);
