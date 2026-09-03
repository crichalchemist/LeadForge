// =py scrapers/nextdoor
import { encodeParams, fetchJson } from './base';

export interface NextdoorProfile {
  nextdoor_id: string | null;
  nextdoor_recommendations: number;
  nextdoor_neighborhood: string | null;
  nextdoor_rating: number | null;
}

interface NextdoorResult {
  id?: string;
  recommendation_count?: number;
  neighborhood?: string;
  rating?: number;
}

// =py search_business — cookies are a constructor argument that no caller supplies, so this always
// returns null. Kept as an argument rather than read from COOKIE_STORE: nothing has ever exercised
// the authenticated path, and the response shape above is unverified.
export async function searchBusiness(
  name: string,
  _zipCode: string,
  cookies: Record<string, string> = {},
): Promise<NextdoorProfile | null> {
  const cookieHeader = Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
  if (!cookieHeader) {
    console.warn('nextdoor_no_cookies', { msg: 'No cookies available, skipping Nextdoor' });
    return null;
  }

  try {
    const params = encodeParams({ query: name, type: 'business' });
    const data = await fetchJson<{ results?: NextdoorResult[] }>(`https://nextdoor.com/api/search/?${params}`, {
      headers: { Cookie: cookieHeader },
    });

    const business = data.results?.[0];
    if (!business) return null;

    return {
      nextdoor_id: business.id ?? null,
      nextdoor_recommendations: business.recommendation_count ?? 0,
      nextdoor_neighborhood: business.neighborhood ?? null,
      nextdoor_rating: business.rating ?? null,
    };
  } catch (error) {
    console.warn('nextdoor_search_failed', { name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
