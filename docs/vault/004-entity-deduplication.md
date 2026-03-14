# ADR-004: Entity deduplication: google_place_id primary, fuzzy name+address fallback

## Status

Accepted

## Date

2026-03-14

## Context

LeadForge ingests businesses from multiple data sources (Google Places, Socrata, later Nextdoor, Craigslist, etc.). The same business will appear in multiple sources with:
- Different names (e.g., "ABC Plumbing" vs. "ABC Plumbing Services")
- Slightly different addresses (e.g., "123 Main St" vs. "123 Main Street")
- Different contact information for the same business

Without robust deduplication, the scoring engine will operate on duplicate records, wasting compute and producing inconsistent results.

We need a deduplication strategy that:
- Handles exact duplicates (same business from re-runs)
- Handles near-duplicates (same business from different sources)
- Is deterministic and version-controlled
- Scales efficiently as the database grows to 100k+ businesses

Technical constraints:
- Phase 1 has limited compute budget; complex fuzzy matching is deferred to Phase 2 with vLLM
- Google Places API is highly canonical for Chicago businesses; google_place_id is globally unique
- Some data sources (Socrata) don't have google_place_id; need fallback dedup

## Decision

Adopt a tiered deduplication approach:

### Tier 1 (Primary): Google Place ID
- Create UNIQUE constraint on `google_place_id` column in Business table
- Phase 1 Google Places ingestion always includes google_place_id
- Any record with matching google_place_id is merged (updated) rather than inserted

### Tier 2 (Fallback): Exact name + zip_code match
- For sources without google_place_id (e.g., early Socrata records), match on exact business name + zip_code
- Case-insensitive name comparison; trailing/leading whitespace stripped
- Zip_code is 5-digit US postal code (sufficient for Chicago deduplication)

### Tier 3 (Phase 2+): vLLM-assisted fuzzy matching
- Implement in Phase 2 after LLM integration is complete
- Use vLLM to embed business names and addresses; find nearest neighbors via vector similarity
- Allows matching "ABC Plumbing" with "ABC Plumbing Services" and different address variants

Implementation details:
- Ingestion pipeline checks Tier 1 (google_place_id UNIQUE constraint enforced by DB)
- Before insert, check Tier 2 match: `SELECT * FROM business WHERE LOWER(name) = LOWER(?) AND zip_code = ?`
- If Tier 2 match found, update existing record instead of inserting
- Phase 2: add vLLM embeddings column; implement similarity search before insert

## Consequences

### Positive
- **Prevents re-run duplicates:** UNIQUE constraint on google_place_id guarantees no duplicates from repeated API calls
- **Google Places reliability:** google_place_id is globally unique and stable; never changes
- **Conservative fallback:** Exact name + zip match is low false-positive rate (may miss some variants, but won't merge different businesses)
- **Scalable:** Tier 1 and Tier 2 are simple indexed lookups (O(1)); Phase 2's vLLM is deferred
- **Future-proof:** Can add more sophisticated matching in Phase 2 without breaking Phase 1 logic

### Negative
- **Name variants missed in Phase 1:** "ABC Plumbing" won't deduplicate with "ABC Plumbing Services" until Phase 2
- **Manual fixup may be needed:** Early data quality issues may require backfill once vLLM matching is live
- **Zip code dependency:** Some businesses span multiple zip codes (unlikely for small businesses, but possible); fallback may fail for edge cases

### Neutral
- Deduplication is gradually enhanced across phases; not a blocker for Phase 1 MVP

## Alternatives Considered

### 1. Fuzzy matching only (no google_place_id primary)
**Why rejected:** Without a golden source, fuzzy matching alone is error-prone. "Mario's Pizza" and "Mario's Pizzeria" might match, but "Mario's Restaurant" and "Mario's Plumbing" should not. Threshold tuning is fragile.

**Trade-offs:** More comprehensive matching, but higher false-positive rate and maintenance burden.

### 2. Address normalization (USPS Postal API)
**Why rejected:** Adds external API dependency and latency. Address normalization is complex (e.g., "Avenue" vs. "Ave", "North" vs. "N"). Not worth the added cost and complexity for Phase 1.

**Trade-offs:** More robust address matching, but adds cost and external dependency.

### 3. No deduplication (manual cleanup post-pipeline)
**Why rejected:** Scoring engine would operate on duplicates, producing inconsistent results and wasting compute. Manual cleanup is non-scalable as data grows.

**Trade-offs:** Simpler pipeline logic, but data quality suffers significantly.

### 4. Composite key (name + zip_code) as primary key
**Why rejected:** google_place_id is more reliable than name/zip (names change, zip codes are not perfectly granular). Composite key would prevent new records with unseen name/zip combinations from being added.

**Trade-offs:** Simpler schema, but loses flexibility to add new businesses discovered from other sources.
