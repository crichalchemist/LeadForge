// =py pipeline/discovery
import { locateCorridor } from './corridors';
import { applyOvertureMatch, fetchOvertureMatch, type PresenceFacts } from './overture';
import { computeDigitalDeficit } from './scoring';
import { nameCorroborates } from './name-match';
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

// =py run_discovery — Socrata → Google Places → score → persist (ADR 030)
export async function runDiscovery(
  env: DiscoveryEnv,
  zipCode: string,
  niche: Niche,
  limit?: number,
  health?: PlacesHealth,
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

// =py _enrich_and_persist — dedup, enrich one business via Google Places, score, and persist
async function enrichAndPersist(
  env: DiscoveryEnv,
  bizData: NormalizedBusiness,
  niche: Niche,
  health?: PlacesHealth,
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

  // Corroborate the Find Place answer BEFORE paying for Details. Find Place already returns the name
  // and the geometry, which is everything the check needs, and Details is the call that carries the
  // dear SKU. Measured: 102 candidates inside the radius, 77 of them the business actually asked
  // for — so this skips 25 Details calls per 157 businesses and, more importantly, keeps the other
  // business's website out of this business's row. A false match is worse than no match: it flips
  // the deficit's 30-point website term on evidence belonging to someone else.
  if (candidate) {
    const location = candidate.geometry?.location;
    const far =
      bizData.latitude !== null &&
      bizData.longitude !== null &&
      location?.lat !== undefined &&
      location?.lng !== undefined &&
      distanceMeters(bizData.latitude, bizData.longitude, location.lat, location.lng) > MATCH_RADIUS_M;

    if (far) {
      // locationbias is a bias, not a filter, so Google answers outside the circle rather than
      // returning nothing. The cut is ours to enforce.
      console.log('place_rejected_out_of_radius', { name, candidate: candidate.name ?? null });
    } else if (!nameCorroborates(name, candidate.name ?? '')) {
      console.log('place_rejected_name', { name, candidate: candidate.name ?? null });
    } else if (candidate.place_id) {
      const details = await getPlaceDetails(env, candidate.place_id, lookups);
      if (details) enrichment = extractEnrichment(details);
    }
  }

  if (health && lookups.unavailable > 0) {
    health.unavailable += lookups.unavailable;
    health.last_status = lookups.last_status;
  }

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
         license_issue_date, account_number, site_number, google_place_id, latitude, longitude,
         in_nof_corridor, nof_corridor_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      businessId,
      // Python passes enrichment.get("name", name), which yields None when Google returns a null
      // name. Workers is the implementation of record here, so an absent value falls back instead.
      enrichment.name ?? name,
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
