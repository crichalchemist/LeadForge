// Name corroboration for enrichment lookups (ADR 030).
//
// A place API returns the nearest candidate, not necessarily the right one. Measured on 157 licensed
// 60619 businesses, Google returned 102 candidates within 200 m of which only 77 were the business
// asked for, and Foursquare returned 140 of which 83 were wrong. A false match is worse than no
// match: it flips the digital deficit's 30-point website term on another business's evidence. So a
// candidate is only used if its name corroborates the licence name.
//
// The score is IDF-weighted fuzzy token containment with a head-token gate. Plain token overlap does
// not work here, because the sector vocabulary is shared by every business in the niche: three words
// ("african", "hair", "braiding") held in common still outvote one distinctive name, which is how
// CONSTANCE AFRICAN HAIR BRAIDING scored 0.61 against an unrelated "Marseillais African Hair
// Braiding". IDF alone only discounts those words; the gate is what settles it. The rarest token in
// the licence name IS the business's identity, so if the candidate does not carry it, nothing else
// can rescue the match.
//
// IDF needs corpus-wide document frequencies, which cannot be computed in a Worker. They are
// precomputed from every named Overture place in Chicago by scripts/gen_name_idf.py and bundled, the
// same way ADR 028 bundles the corridor polygons — and like that asset this is a snapshot, so
// refreshing it means re-running that script and deploying.
import table from '../data/name-idf.json';

const STOP = new Set(table.stop as string[]);
const IDF = table.idf as Record<string, number>;
const DEFAULT_IDF = table.default_idf as number;

/** Threshold pinned by measurement: corroboration is flat at 78/77/76/75 across 0.45–0.60, so 0.50
 *  sits in the middle of a plateau rather than on a cliff. */
export const NAME_MATCH_THRESHOLD = 0.5;

export function tokenizeName(value: string): string[] {
  const out: string[] = [];
  for (const raw of (value ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    // Crude plural/possessive fold. "Sangene's" and "Sangenes" must reach the same token, and the
    // >4 guard keeps it off short words where the trailing s is part of the name.
    out.push(raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** A token absent from the table has df <= 1, so it is maximally rare and takes the default. */
function weight(token: string): number {
  return IDF[token] ?? DEFAULT_IDF;
}

function bigrams(token: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < token.length - 1; i++) out.add(token.slice(i, i + 2));
  return out;
}

function charSimilarity(a: string, b: string): number {
  const ga = bigrams(a);
  const gb = bigrams(b);
  if (ga.size === 0 && gb.size === 0) return 0;
  let shared = 0;
  for (const g of ga) if (gb.has(g)) shared++;
  return shared / (ga.size + gb.size - shared);
}

// Per token, never across the whole string: "Fallou"/"Falou" must match while
// "Constance"/"Marseillais" must not.
function tokensMatch(a: string, b: string): boolean {
  // Prefix rule first. "Brazzaville"/"Brazza" is one name truncated, which bigram overlap scores at
  // 0.50 and would discard a true match.
  if (a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a))) return true;
  return charSimilarity(a, b) >= 0.8;
}

/**
 * 0.0–1.0. `licenceName` is the authority: the score is the share of its IDF mass that the
 * candidate accounts for, so extra words in the candidate never cost anything.
 */
export function nameMatchScore(licenceName: string, candidateName: string): number {
  const licenceTokens = tokenizeName(licenceName);
  const candidateTokens = tokenizeName(candidateName);
  if (licenceTokens.length === 0 || candidateTokens.length === 0) return 0;

  const unique = [...new Set(licenceTokens)];
  const candidates = [...new Set(candidateTokens)];
  const denominator = unique.reduce((sum, t) => sum + weight(t), 0);
  if (denominator <= 0) return 0;

  // Ties broken lexicographically so the gate is deterministic. Two tokens can share the maximum
  // weight whenever both are absent from the table, and without a tie-break which one gates the
  // match would depend on Set iteration order.
  let head = unique[0];
  for (const t of unique) {
    const d = weight(t) - weight(head);
    if (d > 0 || (d === 0 && t < head)) head = t;
  }
  if (!candidates.some((u) => tokensMatch(head, u))) return 0;

  const credit = unique.reduce(
    (sum, t) => (candidates.some((u) => tokensMatch(t, u)) ? sum + weight(t) : sum),
    0,
  );
  return credit / denominator;
}

export function nameCorroborates(licenceName: string, candidateName: string): boolean {
  return nameMatchScore(licenceName, candidateName) >= NAME_MATCH_THRESHOLD;
}
