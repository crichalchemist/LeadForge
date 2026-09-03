// =py scrapers/yelp
import { encodeParams, fetchJson } from './base';

export interface YelpEnv {
  // Python reads this with getattr(settings, "YELP_API_KEY", "") and Settings has no such field,
  // so the Python client is permanently disabled. Setting the Workers secret turns it on.
  YELP_API_KEY?: string;
}

export interface YelpBusiness {
  yelp_id: string | null;
  yelp_review_count: number;
  yelp_rating: number | null;
  yelp_price: string | null;
  yelp_categories: string[];
}

interface YelpApiBusiness {
  id?: string;
  review_count?: number;
  rating?: number;
  price?: string;
  categories?: { title?: string }[];
}

// =py search_business
export async function searchBusiness(env: YelpEnv, name: string, location: string): Promise<YelpBusiness | null> {
  if (!env.YELP_API_KEY) {
    console.warn('yelp_api_key_not_set');
    return null;
  }

  try {
    const params = encodeParams({ term: name, location, limit: '1' });
    const data = await fetchJson<{ businesses?: YelpApiBusiness[] }>(
      `https://api.yelp.com/v3/businesses/search?${params}`,
      { headers: { Authorization: `Bearer ${env.YELP_API_KEY}` } },
    );

    const business = data.businesses?.[0];
    if (!business) return null;

    return {
      yelp_id: business.id ?? null,
      yelp_review_count: business.review_count ?? 0,
      yelp_rating: business.rating ?? null,
      yelp_price: business.price ?? null,
      yelp_categories: (business.categories ?? []).map((c) => c.title).filter((t): t is string => Boolean(t)),
    };
  } catch (error) {
    console.warn('yelp_search_failed', { name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
