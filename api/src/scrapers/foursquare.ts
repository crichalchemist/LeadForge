// Foursquare Places — the enrichment source for discovery. There is no Python counterpart: Python
// enriches from Google Places, whose Cloud project billing is dead indefinitely (see "Data sources"
// in CLAUDE.md), so Workers is the implementation of record for this whole file.
import { DEFAULT_TIMEOUT_MS } from './base';

const BASE_URL = 'https://places-api.foursquare.com';

// Required header. The OpenAPI schema for both endpoints declares it required with an enum of
// exactly one permitted value, so it is a constant rather than a setting.
const API_VERSION = '2025-06-17';

// A search result carries the same field set as GET /places/{id}, so one call enriches a business
// where Google needed find-place *and* details. Naming the fields rather than accepting the
// all-Pro-fields default keeps the set we consume visible in review, and immune to a change in
// what "default" means.
//
// This list is an ENTITLEMENT boundary, not a preference. Measured against a free Service Key on
// 2026-09-16, requesting `rating`, `stats`, `hours`, `price` or `popularity` returns HTTP 429 with
// `x-ratelimit-limit: 0` — not an exhausted quota but an allowance the plan never had, and it
// fails the *whole request*, not just the extra field. Adding one of them here silently breaks
// every lookup. Reviews and rating therefore need a paid plan; see ADR 029.
export const SEARCH_FIELDS =
  'fsq_place_id,name,location,latitude,longitude,website,tel,email,social_media,categories';

// The city geocodes the licence address and a storefront sits within a block of it: wide enough to
// survive geocoder drift, tight enough that the shop two doors down is not a candidate.
const SEARCH_RADIUS_M = 200;

export interface FoursquareEnv {
  FOURSQUARE_API_KEY?: string;
}

/**
 * Per-run tally of lookups that failed for a configuration or quota reason rather than because
 * Foursquare has no record of the business. Callers create one per run and report it: a denied key
 * and a genuine no-match are otherwise indistinguishable in the stored output.
 */
export interface FoursquareHealth {
  unavailable: number;
  last_status: string | null;
}

export function newFoursquareHealth(): FoursquareHealth {
  return { unavailable: 0, last_status: null };
}

export interface FoursquarePlace {
  fsq_place_id?: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  tel?: string;
  email?: string;
  website?: string;
  rating?: number;
  location?: { formatted_address?: string; address?: string };
  social_media?: { facebook_id?: string; instagram?: string; twitter?: string };
  stats?: { total_photos?: number; total_ratings?: number; total_tips?: number };
}

export interface FoursquareEnrichment {
  fsq_place_id: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  /** null when the plan does not entitle `stats` — unmeasured, not zero reviews. */
  google_review_count: number | null;
  google_avg_rating: number | null;
  has_website: boolean;
  has_google_business_profile: boolean;
  has_facebook_page: boolean;
  has_instagram: boolean;
}

/** What discovery knows about a business before any lookup: the city's licence row. */
export interface PlaceQuery {
  name: string;
  address: string;
  zip_code: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Unlike Google — which answers a denied key with HTTP 200 and a `status` field — Foursquare uses
 * real status codes. That is easier to read but harder to survive: `fetchJson` in base.ts throws on
 * any non-2xx, and the throw would unwind past the health tally into runDiscovery's catch, which
 * skips the business entirely. The run would then store nothing while reporting a clean tally — the
 * failure mode PlacesHealth exists to prevent. So this client reads `response.status` itself and
 * never routes through `fetchJson`.
 */
function classifyFailure(status: number): string {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'SERVER_ERROR';
  if (status === 400) return 'BAD_REQUEST';
  return `HTTP_${status}`;
}

function recordUnavailable(health: FoursquareHealth | undefined, status: string, context: object): null {
  console.error('foursquare_unavailable', { ...context, status });
  if (health) {
    health.unavailable += 1;
    health.last_status = status;
  }
  return null;
}

/**
 * One search call per business. Location comes from the city's geocode where it exists, because a
 * point plus a tight radius discriminates far better than the licence name does: those names are
 * legal entities ("MUJ-TA-MIN BARBER SHOP"), not the signage Foursquare indexes.
 */
export async function findPlace(
  env: FoursquareEnv,
  query: PlaceQuery,
  health?: FoursquareHealth,
): Promise<FoursquarePlace | null> {
  if (!env.FOURSQUARE_API_KEY) {
    console.warn('foursquare_api_key_not_set');
    return recordUnavailable(health, 'KEY_NOT_SET', { name: query.name });
  }

  const params: Record<string, string> = {
    query: query.name,
    fields: SEARCH_FIELDS,
    limit: '1',
  };
  if (query.latitude !== null && query.longitude !== null) {
    params.ll = `${query.latitude},${query.longitude}`;
    params.radius = String(SEARCH_RADIUS_M);
  } else {
    // No city geocode for this licence. Fall back to the locality and lean on the address text,
    // which is weaker: `near` biases, it does not bound.
    params.near = 'Chicago, IL';
    params.query = `${query.name} ${query.address}`;
  }

  const url = `${BASE_URL}/places/search?${new URLSearchParams(params).toString()}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        // The legacy v3 API took a bare key; this one declares an http/bearer scheme, so the
        // prefix is required and its absence reads as an invalid key.
        Authorization: `Bearer ${env.FOURSQUARE_API_KEY}`,
        'X-Places-Api-Version': API_VERSION,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    // A timeout or transport failure is not evidence about the business either.
    return recordUnavailable(health, 'NETWORK_ERROR', {
      name: query.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!response.ok) {
    return recordUnavailable(health, classifyFailure(response.status), {
      name: query.name,
      http_status: response.status,
    });
  }

  const data = (await response.json()) as { results?: FoursquarePlace[] };
  const results = data.results ?? [];
  if (results.length === 0) {
    // A genuine no-match: Foursquare answered, and has no such place. This is a measurement.
    console.log('foursquare_place_not_found', { name: query.name });
    return null;
  }
  return results[0];
}

export function extractEnrichment(place: FoursquarePlace): FoursquareEnrichment {
  const social = place.social_media ?? {};
  return {
    fsq_place_id: place.fsq_place_id ?? null,
    name: place.name ?? null,
    address: place.location?.formatted_address ?? place.location?.address ?? null,
    phone: place.tel ?? null,
    website: place.website ?? null,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    // null, never 0, when `stats` is absent. computeDigitalDeficit skips this term on null but
    // charges +10 for a zero, so a 0 here would award a "no reviews" penalty to every business on
    // the plan — the same constant-dressed-as-signal bug as the 74.
    google_review_count: place.stats?.total_ratings ?? null,
    // Foursquare rates 0.0-10.0 where Google rates 0.0-5.0, and `google_avg_rating` is consumed as
    // a Google rating: computeViability awards its top bonus at >= 4.0. Left raw, a mediocre 7.2
    // would max that bonus for nearly every business — a constant dressed as a signal. This is a
    // scale conversion only; it does not claim the two sources' distributions agree. Only ever
    // non-null on a plan entitled to `rating`.
    google_avg_rating: place.rating != null ? place.rating / 2 : null,
    has_website: Boolean(place.website),
    // Reproduces the Google port's rule rather than inventing one. `has_google_business_profile:
    // true` there meant "the source returned a record", not that an owner-managed profile exists —
    // every business Google knows about has a Places record. Matched here means the same thing, so
    // the deficit's 15 points still key on presence in the enrichment source.
    has_google_business_profile: true,
    // Real signal, where the Google port hardcoded both to 0 and so charged every business the
    // same 12-point social penalty.
    has_facebook_page: Boolean(social.facebook_id),
    has_instagram: Boolean(social.instagram),
  };
}
