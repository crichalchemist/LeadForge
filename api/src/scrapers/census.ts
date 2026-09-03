// =py scrapers/census
import { encodeParams, fetchJson } from './base';

// ACS 5-year estimate variables
export const CENSUS_VARIABLES: Record<string, string> = {
  B19013_001E: 'median_household_income',
  B01003_001E: 'total_population',
  B01001_001E: 'total_population_alt',
};

export interface ZipDemographics {
  median_household_income: number | null;
  total_population: number | null;
  population_density: null;
}

// =py get_zip_demographics
export async function getZipDemographics(zipCode: string): Promise<ZipDemographics | null> {
  try {
    const params = encodeParams({
      get: `NAME,${Object.keys(CENSUS_VARIABLES).join(',')}`,
      for: `zip code tabulation area:${zipCode}`,
    });
    const data = await fetchJson<string[][]>(`https://api.census.gov/data/2022/acs/acs5?${params}`);

    if (data.length < 2) return null;

    const [headers, values] = data;
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i];
    });

    return {
      median_household_income: safeFloat(row.B19013_001E),
      total_population: safeFloat(row.B01003_001E),
      // Population density requires land area, approximate with zip-level data
      population_density: null, // Computed separately if land area available
    };
  } catch (error) {
    console.warn('census_lookup_failed', { zip_code: zipCode, error: message(error) });
    return null;
  }
}

// =py _safe_float — Census marks nulls with sentinels like -666666666
export function safeFloat(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // Number('') is 0 where Python's float('') raises, so blanks are rejected before the parse.
  if (value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed < -999999 ? null : parsed;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
