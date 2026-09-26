-- Identity becomes the city's licence account, not any enrichment source's place id (ADR 030).
--
-- Dedup on a source id fails the same way whichever source is chosen: NULLs stay distinct in a
-- UNIQUE index, so a business whose lookup missed is stored again on the next run, and nothing
-- backfills the first copy (lib/enrichment.ts still has no caller). google_place_id hit this, then
-- fsq_place_id inherited it in 0002, and an Overture GERS id would inherit it again -- only 4 of
-- Overture's measured matches even carry a Foursquare source id.
--
-- account_number/site_number is the city's own identifier, it is on every licence row, and it does
-- not change when a licence is renewed the way license_number does. Measured on the live dataset:
-- 157 of 157 licensed 'hair service' businesses in 60619 carry both, 157 distinct pairs, zero
-- collisions. dedupeLicenseRows in scrapers/socrata.ts already computes exactly this key to collapse
-- renewal rows, so the pipeline has been deriving it and then discarding it.
--
-- SQLite cannot add a UNIQUE column through ALTER TABLE, so the constraint is a separate index.
-- NULLs stay distinct there too, which is what makes this safe to apply to a populated table: rows
-- written before this migration carry neither column and so cannot collide with each other. They
-- also will not dedup against anything -- a re-run rediscovers them once, under the new key.
--
-- idx_businesses_fsq_place_id is deliberately left in place. Dropping it belongs with removing the
-- Foursquare client, and keeping it costs nothing while fsq_place_id is still a written column.
ALTER TABLE businesses ADD COLUMN account_number TEXT;
ALTER TABLE businesses ADD COLUMN site_number TEXT;
CREATE UNIQUE INDEX idx_businesses_licence_account ON businesses(account_number, site_number);
