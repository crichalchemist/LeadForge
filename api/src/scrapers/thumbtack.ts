// =py scrapers/thumbtack
import { aggregateRating, encodeParams, extractLdJson, fetchText } from './base';

export interface ThumbtackProfile {
  thumbtack_name: string | null;
  thumbtack_rating: number | null;
  thumbtack_review_count: number | null;
  thumbtack_hires: number | null;
}

// =py search_business — LD+JSON carries no hire count, so thumbtack_hires is always null and the
// enrichment caller's `if tt_data.get("thumbtack_hires")` guard never fires.
export async function searchBusiness(name: string, zipCode: string): Promise<ThumbtackProfile | null> {
  try {
    const params = encodeParams({ search_term: name, zip_code: zipCode });
    const html = await fetchText(`https://www.thumbtack.com/s/?${params}`, { headers: { Accept: 'text/html' } });

    const ldJson = extractLdJson(html);
    if (!ldJson) return null;

    const rating = aggregateRating(ldJson);
    return {
      thumbtack_name: (ldJson.name as string) ?? null,
      thumbtack_rating: (rating.ratingValue as number) ?? null,
      thumbtack_review_count: (rating.reviewCount as number) ?? null,
      thumbtack_hires: null, // Not in LD+JSON, needs deeper parsing
    };
  } catch (error) {
    console.warn('thumbtack_search_failed', { name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
