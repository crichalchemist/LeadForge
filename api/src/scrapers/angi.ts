// =py scrapers/angi
import { aggregateRating, encodeParams, extractLdJson, fetchText } from './base';

export interface AngiProfile {
  angi_name: string | null;
  angi_rating: number | null;
  angi_review_count: number | null;
}

// =py search_business — informational only; the enrichment caller logs the result and stores nothing
export async function searchBusiness(name: string, zipCode: string): Promise<AngiProfile | null> {
  try {
    const params = encodeParams({ query: name, zipCode });
    const html = await fetchText(`https://www.angi.com/search?${params}`, { headers: { Accept: 'text/html' } });

    const ldJson = extractLdJson(html);
    if (!ldJson) return null;

    const rating = aggregateRating(ldJson);
    return {
      angi_name: (ldJson.name as string) ?? null,
      angi_rating: (rating.ratingValue as number) ?? null,
      angi_review_count: (rating.reviewCount as number) ?? null,
    };
  } catch (error) {
    console.warn('angi_search_failed', { name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
