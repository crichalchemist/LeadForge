// =py scrapers/pagespeed
import { encodeParams, fetchJson } from './base';

const TIMEOUT_MS = 60_000; // =py PageSpeedClient timeout=60.0

export interface PageSpeedEnv {
  // Python reuses the Places key here rather than a PageSpeed-specific one.
  GOOGLE_PLACES_API_KEY?: string;
}

export interface PageSpeedResult {
  website_quality_score: number;
  performance_score: number;
  first_contentful_paint: number | null;
}

interface LighthouseResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: { 'first-contentful-paint'?: { numericValue?: number } };
  };
}

// =py analyze — the Lighthouse performance score is 0-1, stored as 0-100
export async function analyze(env: PageSpeedEnv, url: string): Promise<PageSpeedResult | null> {
  try {
    const params: Record<string, string> = { url, category: 'performance', strategy: 'mobile' };
    if (env.GOOGLE_PLACES_API_KEY) params.key = env.GOOGLE_PLACES_API_KEY;

    const data = await fetchJson<LighthouseResponse>(
      `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${encodeParams(params)}`,
      {},
      TIMEOUT_MS,
    );

    const lighthouse = data.lighthouseResult ?? {};
    const score = (lighthouse.categories?.performance?.score || 0) * 100;

    return {
      website_quality_score: score,
      performance_score: score,
      first_contentful_paint: lighthouse.audits?.['first-contentful-paint']?.numericValue ?? null,
    };
  } catch (error) {
    console.warn('pagespeed_analysis_failed', { url, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
