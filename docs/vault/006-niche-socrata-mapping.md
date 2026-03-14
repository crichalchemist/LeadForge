# ADR-006: Niche-to-Socrata mapping: configurable dict, not hardcoded

## Status

Accepted

## Date

2026-03-14

## Context

Phase 1 ingests businesses from the Chicago Data Portal (Socrata), which indexes business licenses by description. The 15 business verticals (niches) defined in the LeadForge PRD must be mapped to Socrata license type search terms.

For example:
- NicheType.PLUMBING maps to license descriptions containing "plumb"
- NicheType.HVAC maps to "hvac", "heating", "air condition"
- NicheType.ELECTRICIAN maps to "electrician", "electrical contractor"

These mappings are:
- Domain knowledge that may evolve as we discover new search terms
- Specific to Chicago's license database structure
- Tested frequently as we refine coverage

We need a mapping strategy that:
- Is maintainable without code changes
- Covers all 15 PRD verticals
- Is version-controlled and tested
- Avoids brittleness (e.g., if mapping is buried in query-building logic)

Technical constraints:
- 15 niches must be covered comprehensively
- Socrata queries are case-insensitive by default
- Some niches have multiple search terms (e.g., HVAC has "heating", "air condition", "hvac")

## Decision

Implement a configurable `NICHE_MAPPING` dictionary in `socrata.py`:

```python
NICHE_MAPPING: dict[NicheType, list[str]] = {
    NicheType.PLUMBING: ["plumb"],
    NicheType.HVAC: ["hvac", "heating", "air condition", "air conditioner"],
    NicheType.ELECTRICIAN: ["electrician", "electrical contractor", "electrical service"],
    NicheType.ROOFING: ["roof", "roofer"],
    NicheType.GENERAL_CONTRACTOR: ["general contractor", "contractor"],
    NicheType.PAINTING: ["paint", "painting"],
    NicheType.LANDSCAPING: ["landscap", "landscape", "lawn", "lawn care"],
    NicheType.CARPET_CLEANING: ["carpet", "rug cleaning", "upholster"],
    NicheType.PEST_CONTROL: ["pest", "pest control", "exterminator"],
    NicheType.WATER_DAMAGE: ["water damage", "restoration", "mold"],
    NicheType.DRYWALL: ["drywall", "sheetrock"],
    NicheType.REAL_ESTATE: ["real estate", "realtor", "broker"],
    NicheType.INSURANCE: ["insurance"],
    NicheType.LOCKSMITH: ["lock", "locksmith"],
    NicheType.TREE_SERVICE: ["tree", "arborist"],
}
```

Usage in SoQL query builder:
- For each niche requested, construct OR condition: `license_description LIKE 'plumb%' OR license_description LIKE 'PLUMB%'` (Socrata's case-insensitive search)
- All 15 niches covered in mapping ensure no niche is missed

Implementation details:
- NICHE_MAPPING is a module-level constant in socrata.py
- Query builder iterates over mapping values to construct WHERE clause
- Unit test verifies all NicheType enum values have mappings
- Integration test verifies each mapping produces > 0 results (or is marked as TODO)

## Consequences

### Positive
- **Easy to update:** Adding a new search term requires changing dict value only; no query logic change
- **Maintainability:** Mapping lives in one place, easy to find and document
- **Testability:** Unit test can verify all 15 niches have mappings; integration test can spot broken mappings
- **Version-controlled:** Mapping changes are tracked in git; easy to revert if a term becomes too broad
- **Clear intent:** Dict format makes it obvious what the mapping does; self-documenting

### Negative
- **False positives possible:** Some search terms may match unrelated businesses (e.g., "paint" might match "painting contractor" or "paint store"); vetting required
- **Socrata-specific:** If we add data sources in Phase 2, each will need its own mapping (acceptable, but duplication)

### Neutral
- Integration tests may need periodic refresh if Socrata's license descriptions change

## Alternatives Considered

### 1. Hardcoded queries per niche
**Why rejected:** Queries scattered throughout codebase; difficult to update consistently. If a search term is ineffective, finding all places it's used is error-prone.

**Trade-offs:** Slightly more flexible per query, but maintenance burden grows as niches are added/removed.

### 2. External config file (JSON or YAML)
**Why rejected:** Overkill for 15 simple mappings. External file adds deployment complexity and reduces IDE support for refactoring.

**Trade-offs:** Allows non-engineers to edit mappings, but not necessary for Phase 1; dict in code is sufficient.

### 3. Regex patterns instead of string lists
**Why rejected:** Regex is harder to maintain and test; string literals are simpler for simple substring matching.

**Trade-offs:** More powerful (e.g., can match "HVAC|H\.V\.A\.C"), but added complexity not justified for straightforward search terms.

### 4. No mapping; require user to specify search terms
**Why rejected:** Shifts burden to user at query time; inconsistent results if user forgets a term.

**Trade-offs:** Maximum flexibility, but poor user experience and data quality.
