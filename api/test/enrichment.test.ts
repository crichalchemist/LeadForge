// Mirrors src/leadforge/pipeline/enrichment.py — one business, every scraper independent.
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enrichBusiness } from '../src/lib/enrichment';
import type { DigitalPresenceRow } from '../src/types';
import { createBusiness, jsonResponse, resetDb, stubFetch } from './helpers';

afterEach(() => vi.unstubAllGlobals());
beforeEach(async () => {
  await resetDb();
});

async function createPresence(businessId: string, overrides: Partial<DigitalPresenceRow> = {}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO digital_presences (id, business_id, has_website, website_url) VALUES (?, ?, ?, ?)',
  )
    .bind(id, businessId, overrides.has_website ?? 1, overrides.website_url ?? 'https://www.shop.example.com')
    .run();
  return id;
}

const presence = (id: string) =>
  env.DB.prepare(
    'SELECT website_quality_score, has_ssl, has_meta_ads, yelp_rating FROM digital_presences WHERE id = ?',
  )
    .bind(id)
    .first<Pick<DigitalPresenceRow, 'website_quality_score' | 'has_ssl' | 'has_meta_ads' | 'yelp_rating'>>();

const business = (id: string) =>
  env.DB.prepare('SELECT thumbtack_hires, nextdoor_recommendations FROM businesses WHERE id = ?')
    .bind(id)
    .first<{ thumbtack_hires: number | null; nextdoor_recommendations: number | null }>();

const origin = (url: string) => new URL(url).origin;

// Routes each scraper's request; anything unrouted fails the test loudly.
function routedFetch(): string[] {
  return stubFetch((url) => {
    if (url.includes('pagespeedonline')) {
      return jsonResponse({ lighthouseResult: { categories: { performance: { score: 0.55 } } } });
    }
    if (url.startsWith('https://www.thumbtack.com')) {
      return new Response('<script type="application/ld+json">{"name":"Shop"}</script>');
    }
    if (url.startsWith('https://www.angi.com')) return new Response('<html></html>');
    if (url.startsWith('https://chicago.craigslist.org')) return new Response('<html></html>');
    if (url === 'https://shop.example.com') return new Response('', { status: 200 });
    throw new Error(`unrouted request: ${url}`);
  });
}

describe('enrichBusiness', () => {
  it('stores the PageSpeed score and the SSL result for a business with a website', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const presenceId = await createPresence(businessId);
    const calls = routedFetch();

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    const dp = await presence(presenceId);
    expect(dp?.website_quality_score).toBeCloseTo(55);
    expect(dp?.has_ssl).toBe(1);
    // Exact set, not a subset: every scraper swallows its own errors, so an unrouted request would
    // otherwise pass silently and a scraper added later would go unnoticed.
    expect(calls.map(origin).sort()).toEqual([
      'https://chicago.craigslist.org',
      'https://shop.example.com',
      'https://www.angi.com',
      'https://www.googleapis.com',
      'https://www.thumbtack.com',
    ]);
  });

  it('strips www before checking the domain', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    await createPresence(businessId);
    const calls = routedFetch();

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    expect(calls).toContain('https://shop.example.com');
  });

  it('skips PageSpeed and the domain check when the business has no website', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const presenceId = await createPresence(businessId, { has_website: 0, website_url: null });
    const calls = routedFetch();

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    expect(calls.some((url) => url.includes('pagespeedonline'))).toBe(false);
    expect(calls).not.toContain('https://shop.example.com');
    const dp = await presence(presenceId);
    expect(dp?.website_quality_score).toBeNull();
    expect(dp?.has_ssl).toBeNull();
  });

  it('writes has_meta_ads = 0 while no Apify token is set', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const presenceId = await createPresence(businessId);
    routedFetch();

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    expect((await presence(presenceId))?.has_meta_ads).toBe(0);
  });

  it('leaves Yelp, Thumbtack and Nextdoor columns untouched when their sources yield nothing', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const presenceId = await createPresence(businessId);
    routedFetch();

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    expect((await presence(presenceId))?.yelp_rating).toBeNull();
    const row = await business(businessId);
    expect(row?.thumbtack_hires).toBeNull();
    expect(row?.nextdoor_recommendations).toBeNull();
  });

  it('finishes when every source fails, recording only what it learned', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const presenceId = await createPresence(businessId);
    stubFetch(() => {
      throw new Error('network down');
    });

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    const dp = await presence(presenceId);
    expect(dp?.website_quality_score).toBeNull();
    expect(dp?.has_ssl).toBe(0); // a failed handshake is a real answer
    expect(dp?.has_meta_ads).toBe(0);
  });

  it('does nothing for a business with no digital presence row', async () => {
    const businessId = await createBusiness({ name: 'Shop' });
    const calls = stubFetch(() => new Response(''));

    await enrichBusiness({ DB: env.DB }, { id: businessId, name: 'Shop', address: '123 Test St', zip_code: '60619' });

    expect(calls).toHaveLength(0);
  });
});
