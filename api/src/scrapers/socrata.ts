// =py scrapers/socrata
import { NICHES } from '../lib/stages';
import { encodeParams, fetchJson } from './base';

export type Niche = (typeof NICHES)[number];

const BASE_URL = 'https://data.cityofchicago.org';
export const DATASET_ID = 'r5kz-chrr'; // Business Licenses dataset
// =py settings.SOCRATA_PAGE_SIZE
export const SOCRATA_PAGE_SIZE = 1000;

// Maps our niche types to Socrata business_activity search terms.
// Terms validated against live dataset 2026-03-14.
export const NICHE_MAPPING: Record<Niche, string[]> = {
  barbershops: ['hair service'],
  nail_salons: ['nail service'],
  beauty_shops: ['hair, nail, and skin care', 'hair service'],
  beauty_supply: ['hair service', 'nail service'],
  tire_shops: ['sale and storage of tires'],
  bars: ['tavern'],
  smoke_shops: ['tobacco'],
  meat_markets: ['butcher'],
  towing: ['tow truck', 'tow storage'],
  lawn_services: ['landscap'],
  mobile_mechanics: ['motor vehicle repair'],
  used_auto_parts: ['junk peddler'],
  septic_services: ['plumb'],
  veterinarians: ['veterinar'],
  security_services: ['security service'],
};

export interface SocrataEnv {
  SOCRATA_APP_TOKEN?: string;
}

export interface SocrataRow {
  account_number?: string;
  site_number?: string;
  latitude?: string;
  longitude?: string;
  legal_name?: string;
  doing_business_as_name?: string;
  address?: string;
  zip_code?: string;
  license_number?: string;
  license_status?: string;
  license_start_date?: string;
  business_activity?: string;
}

export type LicenseStatus = 'active' | 'expired' | 'revoked' | 'unknown';

export interface NormalizedBusiness {
  account_number: string | null;
  site_number: string | null;
  latitude: number | null;
  longitude: number | null;
  name: string;
  address: string;
  zip_code: string;
  phone: null;
  niche: Niche;
  license_number: string | null;
  license_status: LicenseStatus;
  license_issue_date: string | null;
}

// =py search_businesses — pages through SoQL results until a short page, an empty page, or the limit
export async function searchBusinesses(
  env: SocrataEnv,
  zipCode: string,
  niche: Niche,
  limit?: number,
): Promise<SocrataRow[]> {
  let pageSize = SOCRATA_PAGE_SIZE;
  if (limit && limit < pageSize) pageSize = limit;

  const searchTerms = NICHE_MAPPING[niche] ?? [];
  if (searchTerms.length === 0) {
    console.warn('no_niche_mapping', { niche });
    return [];
  }

  const termConditions = searchTerms.map((term) => `upper(business_activity) like upper('%${term}%')`).join(' OR ');
  const whereClause = `zip_code='${zipCode}' AND (${termConditions})`;

  const allResults: SocrataRow[] = [];
  let offset = 0;

  for (;;) {
    const params: Record<string, string> = {
      $where: whereClause,
      $limit: String(pageSize),
      $offset: String(offset),
      $order: 'legal_name ASC',
    };
    if (env.SOCRATA_APP_TOKEN) params.$$app_token = env.SOCRATA_APP_TOKEN;

    const page = await fetchJson<SocrataRow[]>(`${BASE_URL}/resource/${DATASET_ID}.json?${encodeParams(params)}`);

    if (page.length === 0) break;

    allResults.push(...page);
    console.log('socrata_page_fetched', { zip_code: zipCode, niche, count: page.length, total: allResults.length });

    if (page.length < pageSize) break;
    if (limit && allResults.length >= limit) return allResults.slice(0, limit);

    offset += pageSize;
  }

  return allResults;
}

// Socrata types every column as text, latitude included.
function num(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// =py normalize_result, plus the account/site identifiers and coordinates Python leaves on the
// table. The city geocodes 92% of licence rows, so these remove a reason to call Google Places.
export function normalizeResult(raw: SocrataRow, niche: Niche): NormalizedBusiness {
  return {
    account_number: raw.account_number ?? null,
    site_number: raw.site_number ?? null,
    latitude: num(raw.latitude),
    longitude: num(raw.longitude),
    name: raw.doing_business_as_name || raw.legal_name || '',
    address: raw.address ?? '',
    zip_code: raw.zip_code ?? '',
    phone: null, // Not in Socrata data
    niche,
    license_number: raw.license_number ?? null,
    license_status: mapLicenseStatus(raw.license_status),
    license_issue_date: raw.license_start_date ?? null,
  };
}

// =py _map_license_status — dataset legend: AAI = license issued, AAC = cancelled during its term,
// REV = revoked, REA = revocation appealed.
export function mapLicenseStatus(status: string | null | undefined): LicenseStatus {
  if (!status) return 'unknown';
  const lower = status.toLowerCase();
  if (lower.includes('aai') || lower.includes('active')) return 'active';
  if (lower.includes('rev')) return 'revoked';
  return 'expired';
}

// One licence row is one renewal, not one business — a single shop can occupy dozens of rows.
// Collapsing them on the city's own account/site key before enrichment keeps a paid Places lookup
// from being spent on the same storefront repeatedly. The most recent licence wins, so status and
// issue date describe the business today. Rows with no account number fall back to name+zip.
export function dedupeLicenseRows(rows: NormalizedBusiness[]): NormalizedBusiness[] {
  const latest = new Map<string, NormalizedBusiness>();
  for (const row of rows) {
    const key = row.account_number
      ? `${row.account_number}/${row.site_number ?? ''}`
      : `${row.name.toLowerCase()}|${row.zip_code}`;
    const seen = latest.get(key);
    if (!seen || (row.license_issue_date ?? '') > (seen.license_issue_date ?? '')) latest.set(key, row);
  }
  return [...latest.values()];
}
