// =py scrapers/google_places
import { encodeParams, fetchJson } from './base';

// Use field masks to control API costs.
// Basic fields (no charge): place_id, name, formatted_address, geometry, types
// Contact fields ($0.003): formatted_phone_number, website, opening_hours
// Atmosphere fields ($0.005): reviews, rating, user_ratings_total
export const FIND_PLACE_FIELDS = 'place_id,name,formatted_address,geometry';
export const DETAIL_FIELDS =
  'place_id,name,formatted_address,geometry/location,' +
  'formatted_phone_number,website,rating,user_ratings_total,' +
  'business_status,opening_hours,reviews';

const BASE_URL = 'https://maps.googleapis.com';

export interface PlacesEnv {
  GOOGLE_PLACES_API_KEY?: string;
  GOOGLE_PLACES_API_SECRET?: string;
}

/**
 * Per-run tally of Places calls that failed for a configuration or quota reason rather than
 * because Google had no record of the business. Callers create one per run and report it: a
 * denied key and a genuine no-match are otherwise indistinguishable in the stored output.
 */
export interface PlacesHealth {
  unavailable: number;
  last_status: string | null;
}

export function newPlacesHealth(): PlacesHealth {
  return { unavailable: 0, last_status: null };
}

interface PlacesEnvelope {
  status?: string;
  error_message?: string;
}

/**
 * Google answers a denied key, an exhausted quota, and a malformed request with HTTP 200 and a
 * `status` field, so `raise_for_status` never fires and the payload simply lacks its results key.
 * Without this check every such reply reads as "no such business" and the pipeline stores a
 * maximal digital deficit for a shop it never actually looked up.
 *
 * Divergence from Python: neither `find_place` nor `get_place_details` in
 * `scrapers/google_places.py` inspects `status` either. Workers is the implementation of record
 * for this never-run path, so the check lands here and Python keeps the blind spot.
 */
function placesUnavailable(data: PlacesEnvelope, health: PlacesHealth | undefined, context: object): boolean {
  const status = data.status;
  if (!status || status === 'OK' || status === 'ZERO_RESULTS') return false;
  console.error('google_places_unavailable', { ...context, status, error_message: data.error_message });
  if (health) {
    health.unavailable += 1;
    health.last_status = status;
  }
  return true;
}

export interface PlaceCandidate {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
}

export interface PlaceDetails extends PlaceCandidate {
  formatted_phone_number?: string;
  website?: string;
  rating?: number;
  user_ratings_total?: number;
  business_status?: string;
}

export interface PlaceEnrichment {
  google_place_id: string | null;
  name: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  latitude: number | null;
  longitude: number | null;
  google_review_count: number;
  google_avg_rating: number | null;
  has_website: boolean;
  has_google_business_profile: boolean;
}

function base64UrlToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function bytesToBase64Url(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

// =py _sign_url — HMAC-SHA1 over path+query with the base64url-decoded secret. Python keeps the
// base64 padding on the signature, and so must this: Google rejects a stripped one.
export async function signUrl(url: string, secret: string): Promise<string> {
  const { pathname, search } = new URL(url);
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(secret), { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(pathname + search));
  return `${url}&signature=${bytesToBase64Url(signature)}`;
}

// =py _build_signed_url — `key` is appended last, as Python's params dict ordering does
async function buildSignedUrl(env: PlacesEnv, path: string, params: Record<string, string>): Promise<string> {
  const url = `${BASE_URL}${path}?${encodeParams({ ...params, key: env.GOOGLE_PLACES_API_KEY ?? '' })}`;
  if (env.GOOGLE_PLACES_API_SECRET) return signUrl(url, env.GOOGLE_PLACES_API_SECRET);
  return url;
}

// =py find_place
export async function findPlace(
  env: PlacesEnv,
  businessName: string,
  address: string,
  health?: PlacesHealth,
): Promise<PlaceCandidate | null> {
  if (!env.GOOGLE_PLACES_API_KEY) {
    console.warn('google_places_api_key_not_set');
    if (health) {
      health.unavailable += 1;
      health.last_status = 'KEY_NOT_SET';
    }
    return null;
  }

  const url = await buildSignedUrl(env, '/maps/api/place/findplacefromtext/json', {
    input: `${businessName} ${address}`,
    inputtype: 'textquery',
    fields: FIND_PLACE_FIELDS,
  });

  const data = await fetchJson<{ candidates?: PlaceCandidate[] } & PlacesEnvelope>(url);
  if (placesUnavailable(data, health, { name: businessName })) return null;

  const candidates = data.candidates ?? [];
  if (candidates.length === 0) {
    console.log('google_place_not_found', { name: businessName });
    return null;
  }
  return candidates[0];
}

// =py get_place_details
export async function getPlaceDetails(
  env: PlacesEnv,
  placeId: string,
  health?: PlacesHealth,
): Promise<PlaceDetails | null> {
  if (!env.GOOGLE_PLACES_API_KEY) return null;

  const url = await buildSignedUrl(env, '/maps/api/place/details/json', {
    place_id: placeId,
    fields: DETAIL_FIELDS,
  });

  const data = await fetchJson<{ result?: PlaceDetails } & PlacesEnvelope>(url);
  if (placesUnavailable(data, health, { place_id: placeId })) return null;

  if (!data.result) {
    console.log('google_place_details_not_found', { place_id: placeId });
    return null;
  }
  return data.result;
}

// =py extract_enrichment
export function extractEnrichment(details: PlaceDetails): PlaceEnrichment {
  const location = details.geometry?.location ?? {};
  return {
    google_place_id: details.place_id ?? null,
    name: details.name ?? null,
    address: details.formatted_address ?? null,
    phone: details.formatted_phone_number ?? null,
    website: details.website ?? null,
    latitude: location.lat ?? null,
    longitude: location.lng ?? null,
    google_review_count: details.user_ratings_total ?? 0,
    google_avg_rating: details.rating ?? null,
    has_website: Boolean(details.website),
    has_google_business_profile: true, // If we got details, GBP exists
  };
}
