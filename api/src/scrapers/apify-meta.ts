// =py scrapers/apify_meta — only run_actor and get_meta_ads are ported. The four Instagram and
// Facebook helpers beside them have no caller in Python and write columns nothing else reads.
import { encodeParams, fetchJson } from './base';

const BASE_URL = 'https://api.apify.com/v2';
const TIMEOUT_MS = 120_000; // =py ApifyMetaClient timeout=120.0
const POLL_ATTEMPTS = 60; // =py for _ in range(60) — max 5 minutes
const POLL_INTERVAL_MS = 5_000;

export const ACTORS = {
  instagram_profile: 'apify/instagram-scraper',
  instagram_location: 'apify/instagram-scraper',
  instagram_hashtag: 'apify/instagram-scraper',
  facebook_search: 'apify/facebook-posts-scraper',
  meta_ads: 'apify/facebook-ads-library-scraper',
} as const;

export interface ApifyEnv {
  // Python reads this with getattr(settings, "APIFY_API_TOKEN", "") and Settings has no such field,
  // so the Python client is permanently disabled. Setting the Workers secret turns it on.
  APIFY_API_TOKEN?: string;
}

export interface MetaAds {
  has_meta_ads: boolean;
  meta_ads_count: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// =py run_actor — start a run, poll to completion, then read the run's default dataset
export async function runActor(env: ApifyEnv, actorId: string, input: unknown): Promise<unknown[] | null> {
  if (!env.APIFY_API_TOKEN) {
    console.warn('apify_token_not_set');
    return null;
  }

  const token = encodeParams({ token: env.APIFY_API_TOKEN });

  try {
    const run = await fetchJson<{ data?: { id?: string; defaultDatasetId?: string } }>(
      `${BASE_URL}/acts/${actorId}/runs?${token}`,
      { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } },
      TIMEOUT_MS,
    );

    const runId = run.data?.id;
    if (!runId) return null;

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      const status = await fetchJson<{ data?: { status?: string } }>(
        `${BASE_URL}/acts/${actorId}/runs/${runId}?${token}`,
        {},
        TIMEOUT_MS,
      );
      const state = status.data?.status;
      if (state === 'SUCCEEDED') break;
      if (state === 'FAILED' || state === 'ABORTED' || state === 'TIMED-OUT') {
        console.warn('apify_run_failed', { actor: actorId, status: state });
        return null;
      }
    }

    const datasetId = run.data?.defaultDatasetId;
    if (!datasetId) return null;

    return await fetchJson<unknown[]>(
      `${BASE_URL}/datasets/${datasetId}/items?${encodeParams({ token: env.APIFY_API_TOKEN, format: 'json' })}`,
      {},
      TIMEOUT_MS,
    );
  } catch (error) {
    console.warn('apify_actor_failed', { actor: actorId, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

// =py get_meta_ads
export async function getMetaAds(env: ApifyEnv, businessName: string): Promise<MetaAds> {
  const results = await runActor(env, ACTORS.meta_ads, { searchTerms: [businessName], countryCode: 'US' });
  return {
    has_meta_ads: Boolean(results && results.length > 0),
    meta_ads_count: results ? results.length : 0,
  };
}
