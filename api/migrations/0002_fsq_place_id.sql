-- Foursquare replaces Google Places as discovery's enrichment source (the Google Cloud project's
-- billing account is dead indefinitely), so the id that dedups a re-run changes with it. Kept as a
-- separate column rather than reusing google_place_id: the two are different namespaces, and rows
-- already written carry neither.
--
-- SQLite cannot add a UNIQUE column through ALTER TABLE, so the constraint is a separate index.
-- NULLs stay distinct in a UNIQUE index, so businesses that matched nothing do not collide.
ALTER TABLE businesses ADD COLUMN fsq_place_id TEXT;
CREATE UNIQUE INDEX idx_businesses_fsq_place_id ON businesses(fsq_place_id);
