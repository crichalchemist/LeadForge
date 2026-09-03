// =py pipeline/discovery
import { computeDigitalDeficit } from './scoring';
import { extractEnrichment, findPlace, getPlaceDetails, type PlacesEnv, type PlaceEnrichment } from '../scrapers/google-places';
import { normalizeResult, searchBusinesses, type Niche, type NormalizedBusiness, type SocrataEnv } from '../scrapers/socrata';
import { nowIso } from '../db/serialize';

export type DiscoveryEnv = { DB: D1Database } & SocrataEnv & PlacesEnv;

export interface DiscoveredBusiness {
  id: string;
  name: string;
  zip_code: string;
  digital_deficit_score: number;
}

// =py run_discovery — Socrata → Google Places → score → persist
export async function runDiscovery(
  env: DiscoveryEnv,
  zipCode: string,
  niche: Niche,
  limit?: number,
): Promise<DiscoveredBusiness[]> {
  console.log('pipeline_start', { zip_code: zipCode, niche, limit });

  const rawResults = await searchBusinesses(env, zipCode, niche, limit);
  console.log('socrata_results', { count: rawResults.length });
  if (rawResults.length === 0) {
    console.log('no_socrata_results', { zip_code: zipCode, niche });
    return [];
  }

  const normalized = rawResults.map((raw) => normalizeResult(raw, niche));

  const persisted: DiscoveredBusiness[] = [];
  for (const bizData of normalized) {
    try {
      const business = await enrichAndPersist(env, bizData, niche);
      if (business) persisted.push(business);
    } catch (error) {
      console.error('business_enrichment_failed', {
        name: bizData.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log('pipeline_complete', { persisted_count: persisted.length });
  return persisted;
}

// =py _enrich_and_persist — enrich one business via Google Places, dedup, score, and persist
async function enrichAndPersist(
  env: DiscoveryEnv,
  bizData: NormalizedBusiness,
  niche: Niche,
): Promise<DiscoveredBusiness | null> {
  const name = bizData.name.trim();
  if (!name) return null;

  const address = bizData.address;
  const zipCode = bizData.zip_code;

  let enrichment: Partial<PlaceEnrichment> = {};
  const place = await findPlace(env, name, `${address}, Chicago, IL ${zipCode}`);

  if (place) {
    const placeId = place.place_id;
    if (placeId) {
      // Dedup check: does a business with this google_place_id already exist?
      const existing = await env.DB.prepare('SELECT id FROM businesses WHERE google_place_id = ?').bind(placeId).first();
      if (existing) {
        console.log('dedup_google_place_id', { name, place_id: placeId });
        return null;
      }
      const details = await getPlaceDetails(env, placeId);
      if (details) enrichment = extractEnrichment(details);
    }
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

  const businessId = crypto.randomUUID();
  const presenceId = crypto.randomUUID();
  const scoreId = crypto.randomUUID();

  const hasWebsite = enrichment.has_website ?? false;
  const googleReviewCount = enrichment.google_review_count ?? 0;
  const hasGbp = enrichment.has_google_business_profile ?? false;

  // The presence row as it will be stored; the deficit is computed from exactly these values,
  // as Python computes it from the unflushed model where the unset columns read as None/False.
  const deficit = computeDigitalDeficit({
    has_website: hasWebsite ? 1 : 0,
    website_url: null,
    website_quality_score: null,
    has_ssl: null,
    has_google_business_profile: hasGbp ? 1 : 0,
    gbp_completeness_score: null,
    google_review_count: googleReviewCount,
    has_facebook_page: 0,
    has_instagram: 0,
    fb_last_post_days_ago: null,
    has_google_ads: 0,
    has_meta_ads: 0,
  } as Parameters<typeof computeDigitalDeficit>[0]);

  const timestamp = nowIso();

  // Python commits every business in one session at the end of the run; D1 has no cross-statement
  // transaction here, so each business is its own atomic batch — a failure leaves no partial row.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO businesses (id, name, address, zip_code, phone, niche, license_number, license_status,
         license_issue_date, google_place_id, latitude, longitude, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      enrichment.google_place_id ?? null,
      enrichment.latitude ?? null,
      enrichment.longitude ?? null,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO digital_presences (id, business_id, has_website, website_url,
         has_google_business_profile, google_review_count, google_avg_rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      presenceId,
      businessId,
      hasWebsite ? 1 : 0,
      enrichment.website ?? null,
      hasGbp ? 1 : 0,
      googleReviewCount,
      enrichment.google_avg_rating ?? null,
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

  console.log('business_persisted', { name, score: deficit });
  return { id: businessId, name: enrichment.name ?? name, zip_code: zipCode, digital_deficit_score: deficit };
}
