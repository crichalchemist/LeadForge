// =py scrapers/craigslist
import { encodeParams, fetchText } from './base';

const RESULT_TITLE_RE = /class="result-title[^"]*"[^>]*>([^<]+)/g;

export interface CraigslistPresence {
  craigslist_listing_count: number;
  craigslist_has_presence: boolean;
}

// =py search_services — informational only; the enrichment caller logs the result and stores nothing
export async function searchServices(name: string, category = 'bbb'): Promise<CraigslistPresence | null> {
  try {
    const html = await fetchText(`https://chicago.craigslist.org/search/${category}?${encodeParams({ query: name })}`);

    const titles = [...html.matchAll(RESULT_TITLE_RE)].map((m) => m[1]);
    const matching = titles.filter((title) => title.toLowerCase().includes(name.toLowerCase()));

    return {
      craigslist_listing_count: matching.length,
      craigslist_has_presence: matching.length > 0,
    };
  } catch (error) {
    console.warn('craigslist_search_failed', { name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
