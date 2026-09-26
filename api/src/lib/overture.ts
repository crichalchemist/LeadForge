// Precomputed Overture matches, composed with the live Google Places lookup (ADR 030 slice 2).
//
// Overture is a DuckDB query over Parquet and Workers has no DuckDB, so nothing here talks to
// Overture: scripts/build_overture_matches.py does the matching offline and this reads its output.
//
// The two sources are complementary rather than ranked. Measured on 157 licensed 60619 businesses:
// Google corroborated 77 and is the only source carrying rating and review count; Overture
// corroborated 74 and carries 55 websites against Google's 23 (40 of them Overture-only) plus social
// presence for 60 of its matches, where Google reports none. Their union reaches 93.
export interface OvertureMatch {
  account_number: string;
  site_number: string | null;
  matched: number;
  gers_id: string | null;
  matched_name: string | null;
  score: number | null;
  distance_m: number | null;
  website: string | null;
  has_facebook: number;
  has_instagram: number;
  phone: string | null;
}

/** The fields the overlay can change, shared by the ingest path and the backfill. */
export interface PresenceFacts {
  has_website: boolean;
  website_url: string | null;
  has_facebook_page: boolean;
  has_instagram: boolean;
  phone: string | null;
}

/**
 * Never-downgrade overlay. Whatever the live lookup established stands; Overture only ever adds.
 *
 * Deliberately one function for both callers. The backfill applies the same rule to a stored row
 * that discovery applies to a fresh lookup, so the two cannot drift — and a drift here would be
 * invisible, showing up only as businesses scored on different evidence depending on when they were
 * discovered.
 */
// The offline build stores a blank string rather than null for some rows (measured: 82 of 23,969
// with website = '', 5 with phone = '') — trim and collapse those to null so "Overture has
// something" agrees for has_website, website_url and phone by construction, not by three separate
// checks that could drift. Google/base values are never run through this: there is no measured
// evidence the live lookup emits empty strings, and normalizing an unevidenced source is exactly
// the speculative work this project avoids.
function overturePresent(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function applyOvertureMatch(base: PresenceFacts, match: OvertureMatch | null): PresenceFacts {
  // matched = 0 means the build looked and Overture had nothing; a null match means it has not
  // covered this business yet. Neither contributes evidence, and the columns of a no-match row are
  // empty anyway — this guard makes that explicit rather than incidental.
  if (!match || match.matched !== 1) return base;
  const website = overturePresent(match.website);
  const phone = overturePresent(match.phone);
  return {
    has_website: base.has_website || website !== null,
    // Google's URL is fetched live where Overture's is up to a month old, so it leads.
    website_url: base.website_url ?? website,
    has_facebook_page: base.has_facebook_page || match.has_facebook === 1,
    has_instagram: base.has_instagram || match.has_instagram === 1,
    phone: base.phone ?? phone,
  };
}

export async function fetchOvertureMatch(
  db: D1Database,
  accountNumber: string | null,
  siteNumber: string | null,
): Promise<OvertureMatch | null> {
  if (!accountNumber) return null;
  // `IS` rather than `=` so a null site_number matches a null site_number; `=` yields NULL there and
  // the row would never be found.
  return db
    .prepare('SELECT * FROM overture_matches WHERE account_number = ? AND site_number IS ?')
    .bind(accountNumber, siteNumber)
    .first<OvertureMatch>();
}
