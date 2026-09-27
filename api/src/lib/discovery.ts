// =py pipeline/discovery
import { locateCorridor } from './corridors';
import { applyOvertureMatch, fetchOvertureMatch, type PresenceFacts } from './overture';
import { computeDigitalDeficit } from './scoring';
import { NAME_MATCH_THRESHOLD, nameMatchScore } from './name-match';
import {
  MATCH_RADIUS_M,
  distanceMeters,
  extractEnrichment,
  findPlace,
  getPlaceDetails,
  newPlacesHealth,
  type PlaceEnrichment,
  type PlacesEnv,
  type PlacesHealth,
} from '../scrapers/google-places';
import {
  dedupeLicenseRows,
  normalizeResult,
  searchBusinesses,
  type Niche,
  type NormalizedBusiness,
  type SocrataEnv,
} from '../scrapers/socrata';
import { nowIso } from '../db/serialize';
import type { GoogleMatchRow } from '../types';

export type DiscoveryEnv = { DB: D1Database } & SocrataEnv & PlacesEnv;

// Licence rows per business in the result window. Measured against the live dataset, a
// barbershop/salon query averages 3.0 rows per business (508 rows, 168 businesses in 60619),
// so 10 is deliberate headroom for a shop with an unusually long renewal history. It is free:
// the page size is capped at the row limit, so a wider window is the same single request.
const LICENSE_OVERFETCH = 10;

export interface DiscoveredBusiness {
  id: string;
  name: string;
  zip_code: string;
  /** null when the Places lookup failed — unmeasured, not zero-deficit. */
  digital_deficit_score: number | null;
  nof_corridor: string | null;
}

/** Per-run counts the route reports beside the businesses it created (spec 2026-09-26). */
export interface DiscoveryTally {
  /** Licence rows already stored under the same account, or name and zip: skipped before any lookup. */
  skipped_known: number;
  /** Businesses whose enrichment or write threw. They are not stored. */
  failed: number;
}

export function newDiscoveryTally(): DiscoveryTally {
  return { skipped_known: 0, failed: 0 };
}

type GoogleVerdict = Omit<GoogleMatchRow, 'business_id' | 'looked_up_at'>;

// =py run_discovery — Socrata → Google Places → score → persist (ADR 030)
export async function runDiscovery(
  env: DiscoveryEnv,
  zipCode: string,
  niche: Niche,
  limit?: number,
  health?: PlacesHealth,
  tally?: DiscoveryTally,
): Promise<DiscoveredBusiness[]> {
  console.log('pipeline_start', { zip_code: zipCode, niche, limit });

  // `limit` counts businesses, but Socrata returns one row per licence renewal, so ask for more
  // rows than businesses and collapse them. A shop with more than LICENSE_OVERFETCH renewals in
  // the result window can still crowd out others; raising the limit is the remedy.
  const rowLimit = limit ? limit * LICENSE_OVERFETCH : undefined;
  const rawResults = await searchBusinesses(env, zipCode, niche, rowLimit);
  console.log('socrata_results', { count: rawResults.length });
  if (rawResults.length === 0) {
    console.log('no_socrata_results', { zip_code: zipCode, niche });
    return [];
  }

  const deduped = dedupeLicenseRows(rawResults.map((raw) => normalizeResult(raw, niche)));
  const normalized = limit ? deduped.slice(0, limit) : deduped;
  console.log('socrata_businesses', { licence_rows: rawResults.length, businesses: normalized.length });

  const persisted: DiscoveredBusiness[] = [];
  for (const bizData of normalized) {
    try {
      const business = await enrichAndPersist(env, bizData, niche, health, tally);
      if (business) persisted.push(business);
    } catch (error) {
      if (tally) tally.failed += 1;
      console.error('business_enrichment_failed', {
        name: bizData.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('pipeline_complete', {
    persisted_count: persisted.length,
    lookups_unavailable: health?.unavailable ?? 0,
  });
  return persisted;
}

// =py _enrich_and_persist — dedup, enrich one business via Google Places, score, and persist
async function enrichAndPersist(
  env: DiscoveryEnv,
  bizData: NormalizedBusiness,
  niche: Niche,
  health?: PlacesHealth,
  tally?: DiscoveryTally,
): Promise<DiscoveredBusiness | null> {
  const name = bizData.name.trim();
  if (!name) return null;

  const address = bizData.address;
  const zipCode = bizData.zip_code;

  // Dedup FIRST, before anything billable. Identity is the city's licence account (ADR 030), which
  // arrives with the Socrata row, so a business already stored costs zero Places calls on a re-run.
  // Under the previous design the key came out of the lookup response, so the call had to be paid
  // for before the duplicate could be recognised.
  if (bizData.account_number) {
    const existing = await env.DB.prepare(
      'SELECT id FROM businesses WHERE account_number = ? AND site_number IS ?',
    )
      .bind(bizData.account_number, bizData.site_number)
      .first();
    if (existing) {
      console.log('dedup_licence_account', {
        name,
        account_number: bizData.account_number,
        site_number: bizData.site_number,
      });
      if (tally) tally.skipped_known += 1;
      return null;
    }
  } else {
    // Measured 157/157 licences carry an account number, so this is a guard, not a path with data
    // behind it. Name+zip is what the licence dedup already falls back to in scrapers/socrata.ts.
    const existing = await env.DB.prepare('SELECT id FROM businesses WHERE name = ? AND zip_code = ?')
      .bind(name, zipCode)
      .first();
    if (existing) {
      console.log('dedup_name_zip', { name, zip_code: zipCode });
      if (tally) tally.skipped_known += 1;
      return null;
    }
  }

  let enrichment: Partial<PlaceEnrichment> = {};
  // Tally this business's lookups separately, then fold into the run's. Whether *this* business
  // was actually looked up decides whether its deficit is a measurement or a guess.
  const lookups = newPlacesHealth();
  const candidate = await findPlace(env, name, address, lookups, {
    latitude: bizData.latitude,
    longitude: bizData.longitude,
  });

  // What Google said about this business is kept whatever the verdict (ADR 031). The score and the
  // distance used to be computed, used once and discarded, so a rejection could not be explained after
  // the run and a stored value could not be traced to the source that supplied it.
  let verdict: GoogleVerdict = {
    status: 'no_candidate', place_id: null, matched_name: null, score: null, distance_m: null, website: null, phone: null,
  };
  if (candidate) {
    const location = candidate.geometry?.location;
    const distance =
      bizData.latitude !== null && bizData.longitude !== null && location?.lat !== undefined && location?.lng !== undefined
        ? distanceMeters(bizData.latitude, bizData.longitude, location.lat, location.lng)
        : null;
    const score = nameMatchScore(name, candidate.name ?? '');
    verdict = {
      ...verdict,
      place_id: candidate.place_id ?? null,
      matched_name: candidate.name ?? null,
      score,
      distance_m: distance === null ? null : Math.round(distance),
    };

    if (distance !== null && distance > MATCH_RADIUS_M) {
      // locationbias is a bias, not a filter, so Google answers outside the circle rather than
      // returning nothing. The cut is ours to enforce.
      verdict.status = 'rejected_distance';
      console.log('place_rejected_out_of_radius', { name, candidate: candidate.name ?? null });
    } else if (score < NAME_MATCH_THRESHOLD) {
      // The same test nameCorroborates applies; the score is computed once so it can be kept.
      verdict.status = 'rejected_name';
      console.log('place_rejected_name', { name, candidate: candidate.name ?? null });
    } else if (candidate.place_id) {
      const details = await getPlaceDetails(env, candidate.place_id, lookups);
      if (details) {
        enrichment = extractEnrichment(details);
        verdict = { ...verdict, status: 'matched', website: enrichment.website ?? null, phone: enrichment.phone ?? null };
      }
      // Details with no result leaves the verdict at no_candidate, which is how the score below treats
      // it: no profile, no review count. An accepted candidate with no place id is recorded the same way.
    }
  }

  if (health && lookups.unavailable > 0) {
    health.unavailable += lookups.unavailable;
    health.last_status = lookups.last_status;
  }
  // A refused lookup outranks every verdict. Whatever Google said first, this business was not measured,
  // which is exactly the rule that stores its deficit as null below.
  if (lookups.unavailable > 0) verdict.status = 'unavailable';

  const businessId = crypto.randomUUID();
  const presenceId = crypto.randomUUID();
  const scoreId = crypto.randomUUID();

  // Google reports no social presence and finds under half the websites Overture does, so the
  // precomputed match is overlaid before anything is scored (ADR 030 slice 2). The overlay never
  // downgrades: whatever the live lookup established stands.
  const overture = await fetchOvertureMatch(env.DB, bizData.account_number, bizData.site_number);
  const live: PresenceFacts = {
    has_website: enrichment.has_website ?? false,
    website_url: enrichment.website ?? null,
    has_facebook_page: false,
    has_instagram: false,
    phone: enrichment.phone ?? null,
  };
  const facts = applyOvertureMatch(live, overture);

  const hasWebsite = facts.has_website;
  // A stored 0 in either social column is still ambiguous, and narrowly so: it means EITHER Overture
  // matched this licence and recorded no social link — a real measurement — OR there is no match row
  // at all and nothing is known. The columns are INTEGER NOT NULL DEFAULT 0, mirroring the SQLAlchemy
  // model per ADR 026, so they cannot express "unknown", and computeDigitalDeficit tests them for
  // falsiness, so both cases pay its +12 alike. That is the design's stated residual: a business
  // Overture does not cover is charged for absent social presence on no evidence. Making the columns
  // nullable would fork the schema from Python for no scoring gain, so the ambiguity stays and is
  // recorded here rather than rediscovered.
  const hasFacebook = facts.has_facebook_page;
  const hasInstagram = facts.has_instagram;
  // null when no corroborated match was found, 0 when Google returned a place that genuinely has no
  // reviews. computeDigitalDeficit charges +10 for a zero count and skips the term on null, and only
  // a business we actually looked up has earned that charge. Overture carries neither field.
  const googleReviewCount = enrichment.google_review_count ?? null;
  const hasGbp = enrichment.has_google_business_profile ?? false;

  // A failed lookup is not a finding. With the source unavailable every input below is absent and
  // computeDigitalDeficit returns the same constant for every business on earth — one that would
  // sit in lead_scores looking like a measurement, rank nothing (it is 40% of the composite), and
  // trip computeNofEligibility's `deficit > 60` bonus for a business nobody researched. Store null
  // instead: the columns are nullable, and `?? 0` in the NOF scorer already treats null as absent.
  //
  // Divergence from Python, deliberately: pipeline/discovery.py writes the 74.
  //
  // Note this gates the SCORE only. The presence row below is still written from the merged facts, so
  // an unmeasured business can carry an Overture-sourced website while its deficit is null. That is
  // intended: the evidence we actually hold is worth keeping, and the score is what would be
  // incomparable, because the withheld terms (GBP, review count) are exactly the Google-only ones.
  const measured = lookups.unavailable === 0;
  const deficit = !measured ? null : computeDigitalDeficit({
    has_website: hasWebsite ? 1 : 0,
    website_url: null,
    website_quality_score: null,
    has_ssl: null,
    has_google_business_profile: hasGbp ? 1 : 0,
    gbp_completeness_score: null,
    google_review_count: googleReviewCount,
    has_facebook_page: hasFacebook ? 1 : 0,
    has_instagram: hasInstagram ? 1 : 0,
    fb_last_post_days_ago: null,
    has_google_ads: 0,
    has_meta_ads: 0,
  } as Parameters<typeof computeDigitalDeficit>[0]);

  const latitude = bizData.latitude ?? enrichment.latitude ?? null;
  const longitude = bizData.longitude ?? enrichment.longitude ?? null;
  // Python never sets this at ingest — corridor membership was precomputed once against PostGIS,
  // so a business discovered afterwards was silently ineligible for every NOF grant (ADR 028).
  const corridor = locateCorridor(latitude, longitude);

  const timestamp = nowIso();

  // Python commits every business in one session at the end of the run; D1 has no cross-statement
  // transaction here, so each business is its own atomic batch — a failure leaves no partial row.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO businesses (id, name, license_name, address, zip_code, phone, niche, license_number,
         license_status, license_issue_date, account_number, site_number, google_place_id, latitude, longitude,
         in_nof_corridor, nof_corridor_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      businessId,
      // Python passes enrichment.get("name", name), which yields None when Google returns a null
      // name. Workers is the implementation of record here, so an absent value falls back instead.
      enrichment.name ?? name,
      // The city's name for the business: the trimmed licence name every Google candidate is scored against.
      name,
      enrichment.address ?? address,
      zipCode,
      facts.phone,
      niche,
      bizData.license_number,
      bizData.license_status,
      // Python's normalizer extracts this and then discovery drops it; the column exists, so it is stored.
      bizData.license_issue_date ? bizData.license_issue_date.slice(0, 10) : null,
      // Identity (ADR 030). Stored on every row so a re-run dedups before it pays for a lookup.
      bizData.account_number,
      bizData.site_number,
      // An enrichment attribute, not identity — which is why a NULL here no longer breaks dedup.
      enrichment.google_place_id ?? null,
      // The city geocodes the licence address, so its coordinates lead and Google's only fill gaps.
      latitude,
      longitude,
      corridor ? 1 : 0,
      corridor?.corridor_name ?? null,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO google_matches (business_id, status, place_id, matched_name, score, distance_m,
         website, phone, looked_up_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      businessId, verdict.status, verdict.place_id, verdict.matched_name, verdict.score, verdict.distance_m,
      verdict.website, verdict.phone, timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO digital_presences (id, business_id, has_website, website_url,
         has_google_business_profile, google_review_count, google_avg_rating,
         has_facebook_page, has_instagram, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      presenceId,
      businessId,
      hasWebsite ? 1 : 0,
      facts.website_url,
      hasGbp ? 1 : 0,
      googleReviewCount,
      enrichment.google_avg_rating ?? null,
      hasFacebook ? 1 : 0,
      hasInstagram ? 1 : 0,
      timestamp,
      timestamp,
    ),
    // =py LeadScore(score_version=1, ...) — Phase 1 stores the deficit as the composite; the other
    // sub-scores need a competitive context, which the scoring pipeline computes later.
    env.DB.prepare(
      `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score,
         composite_acquisition_score, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?, ?)`,
    ).bind(scoreId, businessId, deficit, deficit, timestamp, timestamp),
  ]);

  console.log('business_persisted', { name, score: deficit, corridor: corridor?.corridor_name ?? null });
  return {
    id: businessId,
    name: enrichment.name ?? name,
    zip_code: zipCode,
    digital_deficit_score: deficit,
    nof_corridor: corridor?.corridor_name ?? null,
  };
}
