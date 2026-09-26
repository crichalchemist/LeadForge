-- Precomputed licence-to-Overture matches (ADR 030 slice 2, spec
-- docs/superpowers/specs/2026-09-25-overture-composition-design.md).
--
-- Overture is a DuckDB query over Parquet on S3 and Workers has no DuckDB, so matching happens
-- offline and only the result is stored. Mirroring the POIs instead is not an option: Chicago holds
-- 214,735 named Overture places against a Workers Free budget of 100,000 D1 row writes per day, so
-- one load would consume three full days and so would every refresh. The 21,004 licence accounts
-- here are a fifth of a single day.
--
-- Keyed on the licence account, the same identity migration 0003 gave `businesses`, so this table
-- needs no place id and does not depend on Overture's GERS ids being stable across monthly releases.
-- Rebuilds are wholesale rather than diffed, which is what makes that irrelevant: no row outlives a
-- rebuild, so `gers_id` is provenance only and never a key.
--
-- `matched = 0` means the build looked and Overture had nothing within 200 m that corroborated the
-- name. NO ROW AT ALL means the build has not covered this business yet. The pipeline already keeps
-- that distinction elsewhere -- it stores a null deficit rather than a fabricated one for a business
-- it never looked up -- and collapsing the two here would make a coverage gap indistinguishable from
-- a genuine no-match.
CREATE TABLE overture_matches (
  account_number TEXT NOT NULL,
  site_number TEXT,
  matched INTEGER NOT NULL,
  gers_id TEXT,
  matched_name TEXT,
  score REAL,
  distance_m INTEGER,
  website TEXT,
  has_facebook INTEGER NOT NULL DEFAULT 0,
  has_instagram INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  built_at TEXT NOT NULL
);

-- NULLs stay distinct in a SQLite UNIQUE index, so a licence with no site_number would not collide
-- with another. Every licence row measured carries both, so this is a guard rather than a live path.
CREATE UNIQUE INDEX idx_overture_matches_account ON overture_matches(account_number, site_number);
