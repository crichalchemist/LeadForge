// =py pipeline/discovery
import { locateCorridor } from './corridors';
import { computeDigitalDeficit } from './scoring';
import {
  extractEnrichment,
  findPlace,
  newFoursquareHealth,
  type FoursquareEnv,
  type FoursquareEnrichment,
  type FoursquareHealth,
} from '../scrapers/foursquare';
import {
  dedupeLicenseRows,
  normalizeResult,
  searchBusinesses,
  type Niche,
  type NormalizedBusiness,
  type SocrataEnv,
} from '../scrapers/socrata';
import { nowIso } from '../db/serialize';

export type DiscoveryEnv = { DB: D1Database } & SocrataEnv & FoursquareEnv;

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

// =py run_discovery — Socrata → Foursquare → score → persist
export async function runDiscovery(
  env: DiscoveryEnv,
  zipCode: string,
  niche: Niche,
  limit?: number,
  health?: FoursquareHealth,
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
      const business = await enrichAndPersist(env, bizData, niche, health);
      if (business) persisted.push(business);
    } catch (error) {
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

// =py _enrich_and_persist — enrich one business via Foursquare, dedup, score, and persist
async function enrichAndPersist(
  env: DiscoveryEnv,
  bizData: NormalizedBusiness,
  niche: Niche,
  health?: FoursquareHealth,
): Promise<DiscoveredBusiness | null> {
  const name = bizData.name.trim();
  if (!name) return null;

  const address = bizData.address;
  const zipCode = bizData.zip_code;

  let enrichment: Partial<FoursquareEnrichment> = {};
  // Tally this business's lookups separately, then fold into the run's. Whether *this* business
  // was actually looked up decides whether its deficit is a measurement or a guess.
  const lookups = newFoursquareHealth();
  const place = await findPlace(
    env,
    { name, address, zip_code: zipCode, latitude: bizData.latitude, longitude: bizData.longitude },
    lookups,
  );

  if (place) {
    const placeId = place.fsq_place_id;
    if (placeId) {
      // Dedup check: does a business with this fsq_place_id already exist?
      const existing = await env.DB.prepare('SELECT id FROM businesses WHERE fsq_place_id = ?').bind(placeId).first();
      if (existing) {
        console.log('dedup_fsq_place_id', { name, place_id: placeId });
        return null;
      }
    }
    // The search response already carries every field a details call would add, so there is no
    // second lookup: where Google cost two subrequests per business, Foursquare costs one.
    enrichment = extractEnrichment(place);
  } else {
    // Fallback dedup: name + zip
    const existing = await env.DB.prepare('SELECT id FROM businesses WHERE name = ? AND zip_code = ?')
      .bind(name, zipCode)
      .first();
    if (existing) {
      console.log('dedup_name_zip', { name, zip_code: zipCode });
      return null;
    }
  }

  if (health && lookups.unavailable > 0) {
    health.unavailable += lookups.unavailable;
    health.last_status = lookups.last_status;
  }

  const businessId = crypto.randomUUID();
  const presenceId = crypto.randomUUID();
  const scoreId = crypto.randomUUID();

  const hasWebsite = enrichment.has_website ?? false;
  const googleReviewCount = enrichment.google_review_count ?? 0;
  const hasGbp = enrichment.has_google_business_profile ?? false;
  const hasFacebook = enrichment.has_facebook_page ?? false;
  const hasInstagram = enrichment.has_instagram ?? false;

  // A failed lookup is not a finding. With the source unavailable every input below is absent and
  // computeDigitalDeficit returns exactly 74 for every business on earth — a constant that would
  // sit in lead_scores looking like a measurement, rank nothing (it is 40% of the composite), and
  // trip computeNofEligibility's `deficit > 60` bonus for a business nobody researched. Store null
  // instead: the columns are nullable, and `?? 0` in the NOF scorer already treats null as absent.
  //
  // Divergence from Python, deliberately: pipeline/discovery.py writes the 74.
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
      `INSERT INTO businesses (id, name, address, zip_code, phone, niche, license_number, license_status,
         license_issue_date, fsq_place_id, latitude, longitude, in_nof_corridor, nof_corridor_name,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      businessId,
      // Python passes enrichment.get("name", name), which yields None when Google returns a null
      // name. Workers is the implementation of record here, so an absent value falls back instead.
      enrichment.name ?? name,
      enrichment.address ?? address,
      zipCode,
      enrichment.phone ?? null,
      niche,
      bizData.license_number,
      bizData.license_status,
      // Python's normalizer extracts this and then discovery drops it; the column exists, so it is stored.
      bizData.license_issue_date ? bizData.license_issue_date.slice(0, 10) : null,
      enrichment.fsq_place_id ?? null,
      // The city geocodes the licence address, so its coordinates lead and Google's only fill gaps.
      latitude,
      longitude,
      corridor ? 1 : 0,
      corridor?.corridor_name ?? null,
      timestamp,
      timestamp,
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
      enrichment.website ?? null,
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
