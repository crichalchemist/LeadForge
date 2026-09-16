// =py pipeline/enrichment
import * as angi from '../scrapers/angi';
import * as apify from '../scrapers/apify-meta';
import * as craigslist from '../scrapers/craigslist';
import { checkDomain } from '../scrapers/domain';
import * as nextdoor from '../scrapers/nextdoor';
import * as pagespeed from '../scrapers/pagespeed';
import * as thumbtack from '../scrapers/thumbtack';
import * as yelp from '../scrapers/yelp';
import type { BusinessRow, DigitalPresenceRow } from '../types';
import { nowIso } from '../db/serialize';

export type EnrichmentEnv = { DB: D1Database } & yelp.YelpEnv & pagespeed.PageSpeedEnv & apify.ApifyEnv;

type EnrichBusiness = Pick<BusinessRow, 'id' | 'name' | 'address' | 'zip_code'>;

// The Python function mutates the ORM objects and flushes once; here the writes are collected
// per table and applied at the end, so one enrichment is one UPDATE per row that changed.
// Keys are column names written as literals in enrichBusiness below and interpolated into the SQL;
// never pass a parsed request body here. Values go through .bind().
type Updates = Record<string, string | number | null>;

async function applyUpdates(db: D1Database, table: 'businesses' | 'digital_presences', id: string, updates: Updates) {
  const columns = Object.keys(updates);
  if (columns.length === 0) return;
  const assignments = columns.map((column) => `${column} = ?`).join(', ');
  await db
    .prepare(`UPDATE ${table} SET ${assignments}, updated_at = ? WHERE id = ?`)
    .bind(...columns.map((column) => updates[column]), nowIso(), id)
    .run();
}

// =py enrich_business — every scraper is independent; a failure is logged and the rest still run
export async function enrichBusiness(env: EnrichmentEnv, business: EnrichBusiness): Promise<void> {
  const dp = await env.DB.prepare(
    'SELECT id, has_website, website_url FROM digital_presences WHERE business_id = ?',
  )
    .bind(business.id)
    .first<Pick<DigitalPresenceRow, 'id' | 'has_website' | 'website_url'>>();

  if (!dp) {
    console.warn('no_digital_presence', { business_id: business.id });
    return;
  }

  const location = `${business.address}, Chicago, IL ${business.zip_code}`;
  const dpUpdates: Updates = {};
  const businessUpdates: Updates = {};

  // Yelp enrichment
  try {
    const yelpData = await yelp.searchBusiness(env, business.name, location);
    if (yelpData) {
      dpUpdates.yelp_review_count = yelpData.yelp_review_count;
      dpUpdates.yelp_rating = yelpData.yelp_rating;
      console.log('yelp_enriched', { business: business.name });
    }
  } catch (error) {
    console.warn('yelp_enrichment_failed', { business: business.name, error: message(error) });
  }

  // PageSpeed enrichment (if website exists)
  if (dp.has_website && dp.website_url) {
    try {
      const psData = await pagespeed.analyze(env, dp.website_url);
      if (psData) {
        dpUpdates.website_quality_score = psData.website_quality_score;
        console.log('pagespeed_enriched', { business: business.name });
      }
    } catch (error) {
      console.warn('pagespeed_enrichment_failed', { business: business.name, error: message(error) });
    }
  }

  // Domain check (if website exists)
  if (dp.has_website && dp.website_url) {
    try {
      const dnsData = await checkDomain(domainOf(dp.website_url));
      dpUpdates.has_ssl = dnsData.has_ssl ? 1 : 0;
      console.log('whois_enriched', { business: business.name });
    } catch (error) {
      console.warn('whois_enrichment_failed', { business: business.name, error: message(error) });
    }
  }

  // Thumbtack
  try {
    const ttData = await thumbtack.searchBusiness(business.name, business.zip_code);
    if (ttData && ttData.thumbtack_hires) businessUpdates.thumbtack_hires = ttData.thumbtack_hires;
  } catch (error) {
    console.warn('thumbtack_enrichment_failed', { business: business.name, error: message(error) });
  }

  // Nextdoor (requires cookies, may not be available)
  try {
    const ndData = await nextdoor.searchBusiness(business.name, business.zip_code);
    if (ndData) businessUpdates.nextdoor_recommendations = ndData.nextdoor_recommendations;
  } catch (error) {
    console.warn('nextdoor_enrichment_failed', { business: business.name, error: message(error) });
  }

  // Craigslist
  try {
    const clData = await craigslist.searchServices(business.name);
    // Craigslist data is informational, not stored in model directly
    if (clData && clData.craigslist_has_presence) console.log('craigslist_presence_found', { business: business.name });
  } catch (error) {
    console.warn('craigslist_enrichment_failed', { business: business.name, error: message(error) });
  }

  // Angi
  try {
    const angiData = await angi.searchBusiness(business.name, business.zip_code);
    // Angi data is informational for now
    if (angiData) console.log('angi_enriched', { business: business.name });
  } catch (error) {
    console.warn('angi_enrichment_failed', { business: business.name, error: message(error) });
  }

  // Apify Meta (Instagram, Facebook, Ads)
  try {
    const adsData = await apify.getMetaAds(env, business.name);
    dpUpdates.has_meta_ads = adsData.has_meta_ads ? 1 : 0;
  } catch (error) {
    console.warn('apify_enrichment_failed', { business: business.name, error: message(error) });
  }

  await applyUpdates(env.DB, 'digital_presences', dp.id, dpUpdates);
  await applyUpdates(env.DB, 'businesses', business.id, businessUpdates);
  console.log('enrichment_complete', { business: business.name, business_id: business.id });
}

// =py urlparse(url).netloc or url, minus a leading www.
// The replace is unanchored in Python too, so "bestwww.example.com" loses its middle. Kept as-is:
// the rule for this port is to preserve Python's behavior unless the platform makes it unsafe, and
// this only misfires on a host where Python already checks the wrong domain.
function domainOf(websiteUrl: string): string {
  let host: string;
  try {
    host = new URL(websiteUrl).host;
  } catch {
    host = websiteUrl;
  }
  return host.replace('www.', '');
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
