# ADR 031 — Keep each Google verdict and the licence name; credit a fact only to the source whose value it shows

**Status:** Accepted
**Date:** 2026-09-26
**Spec:** docs/superpowers/specs/2026-09-26-crm-wave-1-design.md

## Context

Discovery (ADR 030) decides per business whether Google's Find Place candidate is the business it asked
for. It computed the name score and the distance to decide, logged a rejection, and discarded both
numbers. It merged Google's website and phone with Overture's before storage (`applyOvertureMatch`,
Google first), and it overwrote the licence name with Google's. After a run nothing could say why a
business went unmatched, which source supplied its website, or what the city calls it. The CRM rebuild
shows every fact with the source that supplied it (PRODUCT.md: unknown is shown as unknown).

## Decision

1. Migration 0005 adds `businesses.license_name`, the trimmed licence name discovery scores against,
   and a `google_matches` table with one row per business: `status` (`matched`, `rejected_distance`,
   `rejected_name`, `no_candidate`, `unavailable`), the candidate's `place_id` and name, the name
   `score`, the rounded `distance_m`, and Google's own `website` and `phone` before any merge. It
   mirrors `overture_matches`, so the two sources read alike.
2. `unavailable` outranks every other status. Any refused lookup means the business was not measured,
   which is the same rule that stores its deficit as null.
3. `matched` means Details returned a result. An accepted candidate without a place id, or whose Details
   came back empty, is recorded as `no_candidate` with its score and distance, because the score treats
   it exactly as it treats no candidate.
4. `GET /api/businesses/:id/provenance` credits a source for a fact only when its recorded value equals
   the value the record displays, and labels each fact `found`, `none_found`, `unknown` or
   `not_recorded`. The rules live in `api/src/lib/provenance.ts` and nowhere else.
5. No backfill. Rows stored before 0005 have no `google_matches` row and no `license_name`; the record
   says "not recorded" rather than spending Places calls to reconstruct them.

## Consequences

- A rejection can be explained after the run from the stored score or distance.
- When Google and Overture return different websites, only Google is credited, because the record
  shows Google's.
- Details' name is not stored, so an operator's rename after a match (`PATCH /api/businesses/:id`)
  reads as Google's rename and credits Google. Acceptable while renames are rare.
- Identifiers take the American spelling of the existing `license_*` columns: `license_name`, and the
  provenance source key and field `license`. Prose and interface copy keep "licence", as PRODUCT.md and
  DESIGN.md write it ("City licence"), so a mixed spelling across that boundary is deliberate.
- `GET /api/businesses/:id/provenance` admits viewers and returns the licence account and site, Google's
  matched name, and the raw website and phone from both sources. Viewer redaction is not built and no
  viewer accounts exist; when redaction is built, it must cover this route too.
