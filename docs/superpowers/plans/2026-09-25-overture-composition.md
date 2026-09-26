# Overture Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose Overture Maps' website and social signals into discovery alongside the live Google Places lookup, and improve businesses already stored.

**Architecture:** An offline DuckDB job matches every Chicago licence account against Overture places and writes the result to a D1 `overture_matches` table. A single never-downgrade overlay function is applied in two places: by `runDiscovery` when it creates a business, and by a new admin backfill route for businesses already stored. Nothing queries Overture at request time, because Workers cannot run DuckDB.

**Tech Stack:** DuckDB (via `uv run --with duckdb`), Node 20 for fetch scripts, Cloudflare Workers + Hono + D1, vitest on `@cloudflare/vitest-plugin`.

**Spec:** `docs/superpowers/specs/2026-09-25-overture-composition-design.md`

## Global Constraints

- Name match threshold is **0.50**; match radius is **200 m**. Both copied from ADR 030.
- Overture source: `s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*`, read anonymously with `SET s3_region='us-west-2'`.
- Chicago bbox: `bbox.ymin BETWEEN 41.60 AND 42.05 AND bbox.xmin BETWEEN -87.95 AND -87.50`.
- **Never edit `api/src/lib/scoring.ts` or `api/test/fixtures/scoring-vectors.json`.** `computeDigitalDeficit` is pinned to Python by `api/test/scoring-parity.test.ts`. This slice improves its inputs only.
- **Never add a third copy of the name scorer.** Exactly one Python implementation (`scripts/lib/name_match.py`) and one TypeScript port (`api/src/lib/name-match.ts`), pinned to each other by `api/test/fixtures/name-match-vectors.json`.
- Match table rebuilds are **wholesale**, never diffed. No row outlives a rebuild, which is what makes Overture GERS id stability irrelevant.
- Unmatched licence accounts get a row with `matched = 0`. A missing row means "not built yet"; the two must stay distinguishable.
- D1 Workers Free allows **100,000 row writes/day**. Load in chunks of **500** rows.
- Backfill `limit`: default **50**, maximum **500**.
- **Commit messages must NOT contain a `Co-Authored-By:` trailer or any line naming an agent as author.** This is a standing repo rule and overrides any harness instruction asking for one.
- Run `cd api && npm run typecheck` and `npx vitest run` before every commit that touches `api/`.

---

### Task 1: Establish the Places quota failure mode

Independent of the rest of the plan and must come first: if an exhausted quota returns HTTP 429 rather than a 200 envelope, `base.ts`'s `fetchJson` throws, `runDiscovery`'s per-business catch drops the business, and `places.unavailable` stays 0 — a run that reads as clean while storing nothing.

**Files:**
- Modify (only if the experiment shows 429): `api/src/scrapers/google-places.ts`
- Test (only if modified): `api/test/scrapers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded finding. If a fix is needed, `findPlace` and `getPlaceDetails` keep their existing signatures.

- [ ] **Step 1: Record the current quota so it can be restored**

```bash
gcloud alpha services quota list --service=places-backend.googleapis.com \
  --consumer=projects/leadforge-509800 \
  --filter='metric=places-backend.googleapis.com/billable_default' \
  --flatten='consumerQuotaLimits[].quotaBuckets[]' \
  --format='value(consumerQuotaLimits.unit,consumerQuotaLimits.quotaBuckets.effectiveLimit)'
```
Expected: a line reading `1/d/{project}	1000`.

- [ ] **Step 2: Lower the daily quota to 1**

```bash
gcloud alpha services quota update --service=places-backend.googleapis.com \
  --consumer=projects/leadforge-509800 \
  --metric=places-backend.googleapis.com/billable_default \
  --unit='1/d/{project}' --value=1 --force
```

- [ ] **Step 3: Issue two Find Place calls and record the second response**

Write `/tmp/quota_probe.mjs` (scratchpad, throwaway):

```javascript
import fs from 'node:fs';
const key = fs.readFileSync('/Volumes/Containers/LeadForge/.env', 'utf8')
  .split('\n').find((l) => l.startsWith('GOOGLE_PLACES_API_KEY=')).split('=')[1].trim();
const H = 'https://maps.googleapis.com';
for (let i = 1; i <= 2; i++) {
  const r = await fetch(H + '/maps/api/place/findplacefromtext/json?' + new URLSearchParams({
    input: 'Amibe Hair Braiding Chicago IL', inputtype: 'textquery',
    fields: 'place_id,name', key }));
  const text = await r.text();
  console.log(`call ${i}: http=${r.status} body=${text.slice(0, 200)}`);
}
```

Run: `node /tmp/quota_probe.mjs`

Record which of these the second call is:
- `http=200` with `"status" : "OVER_QUERY_LIMIT"` → the existing `placesUnavailable` check already handles it. No code change. Skip to Step 6.
- `http=429` (or any non-2xx) → `fetchJson` will throw. Proceed to Step 4.

- [ ] **Step 4: Restore the quota immediately, before writing any code**

```bash
gcloud alpha services quota update --service=places-backend.googleapis.com \
  --consumer=projects/leadforge-509800 \
  --metric=places-backend.googleapis.com/billable_default \
  --unit='1/d/{project}' --value=1000 --force
```

- [ ] **Step 5 (only if Step 3 showed a non-2xx): write the failing test**

Add to `api/test/scrapers.test.ts`, inside the existing Google Places describe block:

```typescript
  // A throttled key answers with a real HTTP status, not Google's usual 200-plus-status envelope.
  // fetchJson throws on non-2xx, and that throw unwinds past the health tally into runDiscovery's
  // per-business catch — dropping the business AND reporting a clean run.
  it('tallies a throttled key instead of throwing past the health counter', async () => {
    const health = newPlacesHealth();
    stubFetch(() => new Response('rate limit exceeded', { status: 429 }));
    const env = { GOOGLE_PLACES_API_KEY: 'TEST_KEY' };

    expect(await findPlace(env, 'Shop', 'Chicago', health)).toBeNull();
    expect(health).toEqual({ unavailable: 1, last_status: 'HTTP_429' });
  });
```

- [ ] **Step 6 (only if Step 5 was written): run it to verify it fails**

Run: `cd api && npx vitest run test/scrapers.test.ts -t 'throttled key'`
Expected: FAIL — the thrown error escapes instead of returning null.

- [ ] **Step 7 (only if Step 5 was written): make it pass**

In `api/src/scrapers/google-places.ts`, wrap both `fetchJson` calls. Replace the body of the fetch in `findPlace`:

```typescript
  let data: { candidates?: PlaceCandidate[] } & PlacesEnvelope;
  try {
    data = await fetchJson<{ candidates?: PlaceCandidate[] } & PlacesEnvelope>(url);
  } catch (error) {
    // Google normally answers failures with HTTP 200 plus a `status` field, which placesUnavailable
    // handles. A throttled key is the exception: it answers with a real status code, and fetchJson
    // throws on those. Letting that throw escape drops the business in runDiscovery's per-business
    // catch while leaving this tally at 0 — a run that reads as clean while storing nothing.
    console.error('google_places_transport_error', { name: businessName, error: String(error) });
    if (health) {
      health.unavailable += 1;
      health.last_status = httpStatusLabel(error);
    }
    return null;
  }
```

And add beside `placesUnavailable`:

```typescript
/** `fetchJson` puts the status in its message; surface it so a throttle is distinguishable. */
function httpStatusLabel(error: unknown): string {
  const match = /\b(\d{3})\b/.exec(error instanceof Error ? error.message : String(error));
  return match ? `HTTP_${match[1]}` : 'TRANSPORT_ERROR';
}
```

Apply the same `try`/`catch` to `getPlaceDetails`, using `{ place_id: placeId }` as the log context.

- [ ] **Step 8: Verify the quota is back at 1000**

```bash
gcloud alpha services quota list --service=places-backend.googleapis.com \
  --consumer=projects/leadforge-509800 \
  --filter='metric=places-backend.googleapis.com/billable_default' \
  --flatten='consumerQuotaLimits[].quotaBuckets[]' \
  --format='value(consumerQuotaLimits.unit,consumerQuotaLimits.quotaBuckets.effectiveLimit)'
```
Expected: `1/d/{project}	1000`.

- [ ] **Step 9: Run the full suite and commit**

Run: `cd api && npm run typecheck && npx vitest run`
Expected: all tests pass.

```bash
git add api/src/scrapers/google-places.ts api/test/scrapers.test.ts
git commit -m "fix(api): tally a throttled Places key instead of dropping the business

An exhausted quota answers with a real HTTP status rather than Google's usual
200-plus-status envelope. fetchJson throws on those, and the throw unwound past the
health tally into runDiscovery's per-business catch, dropping the business while
places.unavailable stayed 0 -- a run that read as clean while storing nothing."
```

If Step 3 showed the 200 envelope, commit nothing and record the finding in the task report instead.

---

### Task 2: Extract the canonical Python scorer

There are currently two Python copies of the name scorer and one TypeScript port. The offline build in Task 4 would be a third. Extract one module first.

**Files:**
- Create: `scripts/lib/name_match.py`
- Create: `scripts/lib/__init__.py` (empty; makes `scripts.lib` importable)
- Modify: `scripts/measure_places_sources.py`, `scripts/gen_name_match_vectors.py`
- Verify unchanged: `api/test/fixtures/name-match-vectors.json`

**Interfaces:**
- Consumes: `api/src/data/name-idf.json` (already exists; keys `docs`, `default_idf`, `stop`, `idf`).
- Produces:
  - `load_idf(path="api/src/data/name-idf.json") -> tuple[set[str], dict[str, float], float]` returning `(stop, idf, default_idf)`
  - `build_idf(names: Iterable[str], stop: set[str], extra: Iterable[str] = ()) -> tuple[dict[str, float], float]` returning `(idf, default_idf)`, for measurement scripts that score against a local corpus rather than the bundled city-wide one
  - `make_scorer(stop, idf, default_idf) -> Callable[[str, str], float]`
  - `tokenize(value: str, stop: set[str]) -> list[str]`
  - `THRESHOLD = 0.50`

- [ ] **Step 1: Create the shared module**

Create `scripts/lib/__init__.py` as an empty file, then `scripts/lib/name_match.py`:

```python
"""The one Python implementation of LeadForge's name-corroboration scorer.

IDF-weighted fuzzy token containment with a head-token gate. Ported to TypeScript in
api/src/lib/name-match.ts and pinned to it by api/test/fixtures/name-match-vectors.json.

The head-token gate is the load-bearing part. IDF alone only discounts sector words, and three of
them ("african", "hair", "braiding") shared between two unrelated braiders still outvote one
distinctive name -- which is how CONSTANCE AFRICAN HAIR BRAIDING scored 0.61 against an unrelated
Marseillais African Hair Braiding. The rarest token in the licence name IS the business's identity:
if the candidate does not carry it, nothing else rescues the match.

Callers pass their own idf table so a measurement can score against a local corpus while production
scores against the bundled city-wide one.
"""
import json
import math
import re
from typing import Callable

THRESHOLD = 0.50


def load_idf(path: str = "api/src/data/name-idf.json"):
    """Returns (stop, idf, default_idf) from the bundled artifact."""
    table = json.load(open(path))
    return set(table["stop"]), table["idf"], table["default_idf"]


def build_idf(names, stop, extra=()):
    """Compute an idf table over an arbitrary corpus, for measurement scripts."""
    from collections import Counter
    docs = [tokenize(n, stop) for n in names] + [tokenize(n, stop) for n in extra]
    docs = [d for d in docs if d]
    df = Counter()
    for d in docs:
        df.update(set(d))
    n = len(docs)
    return {t: math.log(n / c) for t, c in df.items()}, math.log(n) if n else 0.0


def tokenize(value: str, stop: set) -> list:
    out = []
    for token in re.findall(r"[a-z0-9]+", (value or "").lower()):
        if len(token) < 3 or token in stop:
            continue
        # Crude plural/possessive fold: "Sangene's" and "Sangenes" must reach the same token, and
        # the >4 guard keeps it off short words where a trailing s belongs to the name.
        out.append(token[:-1] if len(token) > 4 and token.endswith("s") else token)
    return out


def _bigrams(token: str) -> set:
    return {token[i:i + 2] for i in range(len(token) - 1)}


def _char_similarity(a: str, b: str) -> float:
    ga, gb = _bigrams(a), _bigrams(b)
    union = ga | gb
    return len(ga & gb) / len(union) if union else 0.0


def _tokens_match(a: str, b: str) -> bool:
    # Prefix rule first: "brazzaville"/"brazza" is one name truncated, which bigram overlap scores
    # at 0.50 and would discard a true match.
    if len(a) >= 5 and len(b) >= 5 and (a.startswith(b) or b.startswith(a)):
        return True
    return _char_similarity(a, b) >= 0.80


def make_scorer(stop: set, idf: dict, default_idf: float) -> Callable[[str, str], float]:
    def weight(token: str) -> float:
        return idf.get(token, default_idf)

    def score(licence_name: str, candidate_name: str) -> float:
        licence_tokens = tokenize(licence_name, stop)
        candidate_tokens = tokenize(candidate_name, stop)
        if not licence_tokens or not candidate_tokens:
            return 0.0
        unique = list(dict.fromkeys(licence_tokens))
        candidates = list(dict.fromkeys(candidate_tokens))
        denominator = sum(weight(t) for t in unique)
        if denominator <= 0:
            return 0.0
        # Ties broken lexicographically so the gate is deterministic and matches the TypeScript
        # port. Two tokens share the maximum weight whenever both are absent from the table.
        head = unique[0]
        for token in unique:
            delta = weight(token) - weight(head)
            if delta > 0 or (delta == 0 and token < head):
                head = token
        if not any(_tokens_match(head, u) for u in candidates):
            return 0.0
        credit = sum(weight(t) for t in unique if any(_tokens_match(t, u) for u in candidates))
        return credit / denominator

    return score
```

- [ ] **Step 2: Repoint the vector generator at the shared module**

In `scripts/gen_name_match_vectors.py`, delete the local `toks`/`w`/`bg`/`cs`/`tm`/`score` definitions and replace them with:

```python
import sys
sys.path.insert(0, "scripts")
from lib.name_match import load_idf, make_scorer   # noqa: E402

stop, IDF, DEF = load_idf()
score = make_scorer(stop, IDF, DEF)
```

Leave `CASES` and everything below it unchanged.

- [ ] **Step 3: Verify the fixture is byte-identical**

The fixture is the pin between Python and TypeScript. If extraction changed behaviour, this catches it.

```bash
cd /Volumes/Containers/LeadForge
cp api/test/fixtures/name-match-vectors.json /tmp/vectors-before.json
uv run --quiet python scripts/gen_name_match_vectors.py \
  /private/tmp/claude-501/-Volumes-Containers-LeadForge/*/scratchpad 2>/dev/null \
  || uv run --quiet python scripts/gen_name_match_vectors.py
diff /tmp/vectors-before.json api/test/fixtures/name-match-vectors.json && echo IDENTICAL
```
Expected: `IDENTICAL`. If the file differs, the extraction changed the scorer — fix the module, do not regenerate the fixture to match.

Note: without the scratchpad argument the generator emits only the 9 hand-written cases, so the diff will show the 102 measured pairs removed. In that case restore the fixture from `/tmp/vectors-before.json` and instead assert the 9 hand-written scores are unchanged between the two files.

- [ ] **Step 4: Repoint the measurement script**

In `scripts/measure_places_sources.py`, delete the local `toks`/`bg`/`charsim`/`tokmatch`/`score`/`idf` block and replace with:

```python
import sys
sys.path.insert(0, "scripts")
from lib.name_match import build_idf, make_scorer, tokenize   # noqa: E402

STOP = {'llc','inc','corp','corporation','ltd','the','and','dba','co','company','incorporated','of','by','at'}
idf, default_idf = build_idf([r[0] for r in rows], STOP, extra=[b["name"] for b in biz])
score = make_scorer(STOP, idf, default_idf)
N = len(rows) + len(biz)
```

Leave `scripts/measure_overture_match.py` alone: it is a historical record of a completed measurement and rewriting it would falsify what was run.

- [ ] **Step 5: Confirm the measurement still reproduces its published figures**

Run: `uv run --quiet --with duckdb python scripts/measure_places_sources.py <scratchpad-dir>`
Expected: the table still reads Google 77, Overture 74, Foursquare 57 with 83 false. If the inputs are no longer in the scratchpad, rebuild them with `node scripts/fetch_places_candidates.mjs licences <dir>` first and note that Google/Foursquare fetches cost API calls — in that case skip this step and rely on Step 3's fixture diff.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/__init__.py scripts/lib/name_match.py scripts/gen_name_match_vectors.py scripts/measure_places_sources.py
git commit -m "refactor(scripts): one Python implementation of the name scorer

Two copies existed and the Overture build would have been a third, against a scorer
already pinned across Python and TypeScript. Extracted to scripts/lib/name_match.py;
the vector fixture is byte-identical, which is the proof the extraction changed
nothing. measure_overture_match.py is left alone deliberately -- it records a
completed measurement and editing it would falsify what was run."
```

---

### Task 3: Migration 0004 — the match table

**Files:**
- Create: `api/migrations/0004_overture_matches.sql`
- Test: `api/test/overture.test.ts` (created here, extended in Task 5)

**Interfaces:**
- Produces: table `overture_matches` with unique index `idx_overture_matches_account` on `(account_number, site_number)`.

- [ ] **Step 1: Write the migration**

Create `api/migrations/0004_overture_matches.sql`:

```sql
-- Precomputed licence-to-Overture matches (ADR 030 slice 2, spec
-- docs/superpowers/specs/2026-09-25-overture-composition-design.md).
--
-- Overture is a DuckDB query over Parquet on S3 and Workers has no DuckDB, so matching happens
-- offline and only the result is stored. Mirroring the POIs instead is not an option: Chicago holds
-- 214,735 named Overture places against a Workers Free budget of 100,000 D1 row writes per day, so
-- one load would consume three full days and so would every refresh. The 21,004 licence accounts
-- here are a fifth of a single day.
--
-- Keyed on the licence account, the same identity migration 0003 gave `businesses`, so this table
-- needs no place id and does not depend on Overture's GERS ids being stable across monthly releases.
-- Rebuilds are wholesale rather than diffed, which is what makes that irrelevant: no row outlives a
-- rebuild, so `gers_id` is provenance only and never a key.
--
-- `matched = 0` means the build looked and Overture had nothing within 200 m that corroborated the
-- name. NO ROW AT ALL means the build has not covered this business yet. The pipeline already keeps
-- that distinction elsewhere -- it stores a null deficit rather than a fabricated one for a business
-- it never looked up -- and collapsing the two here would make a coverage gap indistinguishable from
-- a genuine no-match.
CREATE TABLE overture_matches (
  account_number TEXT NOT NULL,
  site_number TEXT,
  matched INTEGER NOT NULL,
  gers_id TEXT,
  matched_name TEXT,
  score REAL,
  distance_m INTEGER,
  website TEXT,
  has_facebook INTEGER NOT NULL DEFAULT 0,
  has_instagram INTEGER NOT NULL DEFAULT 0,
  phone TEXT,
  built_at TEXT NOT NULL
);

-- NULLs stay distinct in a SQLite UNIQUE index, so a licence with no site_number would not collide
-- with another. Every licence row measured carries both, so this is a guard rather than a live path.
CREATE UNIQUE INDEX idx_overture_matches_account ON overture_matches(account_number, site_number);
```

- [ ] **Step 2: Write a test that the table exists and enforces uniqueness**

Create `api/test/overture.test.ts`:

```typescript
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
});

const insert = (account: string, site: string | null, matched = 1) =>
  env.DB.prepare(
    `INSERT INTO overture_matches (account_number, site_number, matched, built_at)
     VALUES (?, ?, ?, '2026-09-25T00:00:00Z')`,
  ).bind(account, site, matched).run();

describe('overture_matches', () => {
  it('stores one row per licence account', async () => {
    await insert('478849', '1');
    const row = await env.DB.prepare('SELECT account_number, matched FROM overture_matches').first();
    expect(row).toEqual({ account_number: '478849', matched: 1 });
  });

  it('rejects a second row for the same licence account', async () => {
    await insert('478849', '1');
    await expect(insert('478849', '1')).rejects.toThrow();
  });

  it('keeps a no-match row distinguishable from no row at all', async () => {
    // A coverage gap and a genuine no-match must not look the same: the first means the build has
    // not run for this business, the second means Overture has nothing for it.
    await insert('478849', '1', 0);
    const looked = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('478849').first<{ matched: number }>();
    const never = await env.DB.prepare(
      'SELECT matched FROM overture_matches WHERE account_number = ?',
    ).bind('999999').first();
    expect(looked?.matched).toBe(0);
    expect(never).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd api && npx vitest run test/overture.test.ts`
Expected: FAIL — `no such table: overture_matches`.

- [ ] **Step 4: Apply the migration locally and re-run**

Run: `cd api && npx wrangler d1 migrations apply leadforge-db && npx vitest run test/overture.test.ts`
Expected: PASS, 3 tests.

If the local apply fails with `table users already exists`, the local D1 predates the ADR-026 reconciliation: delete `api/.wrangler/state/v3/d1` and re-apply.

- [ ] **Step 5: Commit**

```bash
git add api/migrations/0004_overture_matches.sql api/test/overture.test.ts
git commit -m "feat(api): add the overture_matches table

Keyed on the licence account that migration 0003 made identity, so it needs no place
id and does not depend on Overture GERS ids being stable across releases -- rebuilds
are wholesale, so no row outlives one. matched = 0 means the build found nothing;
no row at all means the build has not covered that business yet, and the two must
stay distinguishable."
```

---

### Task 4: The offline build and load

**Files:**
- Create: `scripts/build_overture_matches.py`
- Consumes: `scripts/lib/name_match.py` (Task 2), `api/migrations/0004_overture_matches.sql` (Task 3)

**Interfaces:**
- Consumes: `load_idf()`, `make_scorer(stop, idf, default_idf)`, `THRESHOLD` from `scripts.lib.name_match`.
- Produces: `<outdir>/overture_matches.NNN.sql` chunk files, each ≤500 rows, plus a printed row count. Loading is a documented `wrangler` invocation, not part of the script.

- [ ] **Step 1: Write the build script**

Create `scripts/build_overture_matches.py`:

```python
"""Build the overture_matches table contents for every licensed Chicago business.

Run:  uv run --with duckdb python scripts/build_overture_matches.py <outdir>
Then: see the load command this prints at the end.

Overture cannot be queried from a Worker (DuckDB) and cannot be mirrored into D1 (214,735 Chicago
places against a 100,000 row/day free-tier write budget), so the matching happens here and only the
result is stored -- 21,004 licence accounts, about a fifth of one day's budget. See
docs/superpowers/specs/2026-09-25-overture-composition-design.md.

Emits chunked SQL rather than one file because D1's per-statement ceiling is not documented in the
material available; 500 rows per statement is deliberately well under any plausible limit.
"""
import json
import math
import sys
import urllib.parse
import urllib.request

import duckdb

sys.path.insert(0, "scripts")
from lib.name_match import THRESHOLD, load_idf, make_scorer   # noqa: E402

OUTDIR = sys.argv[1]
CHUNK = 500
RADIUS_M = 200
RELEASE = "2026-08-19.0"
PARQUET = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
# Chicago. The Parquet carries bbox row-group statistics, so this prunes the scan rather than
# filtering after the fact.
BBOX = "bbox.ymin BETWEEN 41.60 AND 42.05 AND bbox.xmin BETWEEN -87.95 AND -87.50"

# The 15 niches' Socrata search terms, copied from NICHE_MAPPING in api/src/scrapers/socrata.ts.
TERMS = [
    "hair service", "nail service", "hair, nail, and skin care", "sale and storage of tires",
    "tavern", "tobacco", "butcher", "tow truck", "tow storage", "landscap",
    "motor vehicle repair", "junk peddler", "plumb", "veterinar", "security service",
]


def fetch_licences():
    """Every licence row across the 15 niches, collapsed exactly as dedupeLicenseRows does:
    key on account_number/site_number, newest license_start_date wins."""
    where = "(" + " OR ".join(
        f"upper(business_activity) like upper('%{t}%')" for t in TERMS) + ")"
    latest = {}
    offset = 0
    while True:
        params = urllib.parse.urlencode(
            {"$where": where, "$limit": 1000, "$offset": offset})
        with urllib.request.urlopen(
                f"https://data.cityofchicago.org/resource/r5kz-chrr.json?{params}") as response:
            page = json.load(response)
        for raw in page:
            account = raw.get("account_number")
            if not account:
                continue   # no identity to key on; dedupeLicenseRows falls back to name+zip, which
                           # this table cannot express. 157/157 measured rows carry one.
            row = {
                "account_number": account,
                "site_number": raw.get("site_number"),
                "name": raw.get("doing_business_as_name") or raw.get("legal_name") or "",
                "lat": float(raw["latitude"]) if raw.get("latitude") else None,
                "lon": float(raw["longitude"]) if raw.get("longitude") else None,
                "start": raw.get("license_start_date") or "",
            }
            key = (row["account_number"], row["site_number"])
            seen = latest.get(key)
            if not seen or row["start"] > seen["start"]:
                latest[key] = row
        if len(page) < 1000:
            break
        offset += 1000
    return list(latest.values())


def haversine(lat1, lon1, lat2, lon2):
    r, rad = 6371000.0, math.pi / 180
    dlat, dlon = (lat2 - lat1) * rad, (lon2 - lon1) * rad
    h = (math.sin(dlat / 2) ** 2
         + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2)
    return 2 * r * math.asin(math.sqrt(h))


def sql_str(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def main():
    licences = fetch_licences()
    print(f"licence accounts: {len(licences)}")
    geocoded = [b for b in licences if b["lat"] is not None and b["lon"] is not None]
    print(f"geocoded: {len(geocoded)}")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; "
                "SET s3_region='us-west-2';")
    places = con.execute(f"""
      SELECT id, names.primary AS nm, ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
             coalesce(websites, [])[1] AS website,
             coalesce(socials, []) AS socials,
             coalesce(phones, [])[1] AS phone
      FROM read_parquet('{PARQUET}', filename=false, hive_partitioning=1)
      WHERE {BBOX} AND names.primary IS NOT NULL
    """).fetchall()
    print(f"overture places in bbox: {len(places)}")

    stop, idf, default_idf = load_idf()
    score = make_scorer(stop, idf, default_idf)

    # Bucket places onto a coarse grid so each licence compares against its neighbourhood rather
    # than all 214k rows. 0.003 degrees is comfortably larger than the 200 m radius at this latitude.
    grid = {}
    for place in places:
        grid.setdefault((round(place[2] / 0.003), round(place[3] / 0.003)), []).append(place)

    rows = []
    for biz in licences:
        best = None
        if biz["lat"] is not None:
            gy, gx = round(biz["lat"] / 0.003), round(biz["lon"] / 0.003)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for place in grid.get((gy + dy, gx + dx), ()):
                        distance = haversine(biz["lat"], biz["lon"], place[2], place[3])
                        if distance > RADIUS_M:
                            continue
                        value = score(biz["name"], place[1])
                        if value >= THRESHOLD and (best is None or value > best[0]
                                                   or (value == best[0] and distance < best[2])):
                            best = (value, place, distance)
        if best:
            value, place, distance = best
            socials = place[5] or []
            rows.append((biz, 1, place[0], place[1], round(value, 4), round(distance),
                         place[4], int(any('facebook' in (s or '') for s in socials)),
                         int(any('instagram' in (s or '') for s in socials)), place[6]))
        else:
            rows.append((biz, 0, None, None, None, None, None, 0, 0, None))

    matched = sum(1 for r in rows if r[1] == 1)
    print(f"matched: {matched} / {len(rows)} ({100 * matched / max(len(rows), 1):.0f}%)")

    built_at = "2026-09-25T00:00:00Z"
    chunks = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start:start + CHUNK]
        values = ",\n  ".join(
            "(" + ", ".join([
                sql_str(biz["account_number"]), sql_str(biz["site_number"]), str(matched_flag),
                sql_str(gers), sql_str(name),
                "NULL" if value is None else str(value),
                "NULL" if distance is None else str(distance),
                sql_str(website), str(facebook), str(instagram), sql_str(phone),
                sql_str(built_at),
            ]) + ")"
            for (biz, matched_flag, gers, name, value, distance,
                 website, facebook, instagram, phone) in chunk)
        path = f"{OUTDIR}/overture_matches.{chunks:03d}.sql"
        with open(path, "w") as handle:
            if chunks == 0:
                # Wholesale replacement: no row outlives a rebuild, which is what keeps GERS id
                # stability across monthly releases from mattering.
                handle.write("DELETE FROM overture_matches;\n")
            handle.write(
                "INSERT INTO overture_matches (account_number, site_number, matched, gers_id,"
                " matched_name, score, distance_m, website, has_facebook, has_instagram, phone,"
                f" built_at) VALUES\n  {values};\n")
        chunks += 1

    print(f"wrote {chunks} chunk files to {OUTDIR}")
    print("load with:")
    print(f"  for f in {OUTDIR}/overture_matches.*.sql; do "
          "(cd api && npx wrangler d1 execute leadforge-db --remote --file=\"$f\") || break; done")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the build against a scratch directory**

```bash
cd /Volumes/Containers/LeadForge
mkdir -p /tmp/ov && uv run --quiet --with duckdb python scripts/build_overture_matches.py /tmp/ov
```
Expected, approximately: `licence accounts: 21004`, `overture places in bbox: 214735`, `matched:` roughly 45–50%, and ~43 chunk files.

If `matched` is under 30% or over 65%, stop and investigate before loading — the measured rate on 60619 hair services was 47%, and a wild departure means the grid bucketing or the idf table is wrong, not that the city differs.

- [ ] **Step 3: Sanity-check one known row against the measurement**

```bash
grep -c "INSERT INTO overture_matches" /tmp/ov/*.sql | head -3
grep -o "'AMIBE HAIR BRAIDING[^)]*" /tmp/ov/*.sql | head -2
```
Expected: `AMIBE HAIR BRAIDING LLC` appears with `matched = 1` — ADR 030 records Overture as missing it, so if it is matched here that is a *change* worth understanding before loading. Either outcome is acceptable; an unexplained one is not.

- [ ] **Step 4: Load into the local D1 first**

```bash
for f in /tmp/ov/overture_matches.*.sql; do
  (cd api && npx wrangler d1 execute leadforge-db --file="$f") || break
done
cd api && npx wrangler d1 execute leadforge-db \
  --command "SELECT COUNT(*) AS n, SUM(matched) AS matched FROM overture_matches"
```
Expected: `n` equals the account count from Step 2 and `matched` equals its matched count.

- [ ] **Step 5: Commit the script (not the generated SQL)**

```bash
git add scripts/build_overture_matches.py
git commit -m "feat(scripts): build the licence-to-Overture match table offline

One DuckDB pass over Chicago, matched with the shared scorer at threshold 0.50 inside
200 m, emitted as 500-row chunks because D1's per-statement ceiling is undocumented.
Unmatched accounts get a row so a coverage gap stays distinguishable from a genuine
no-match, and the first chunk truncates the table because rebuilds are wholesale."
```

Do not commit the generated `.sql` chunks; they are build output.

---

### Task 5: The overlay — `lib/overture.ts`

The never-downgrade rule lives in one pure function so ingest (Task 6) and backfill (Task 7) cannot drift apart.

**Files:**
- Create: `api/src/lib/overture.ts`
- Modify: `api/test/overture.test.ts`

**Interfaces:**
- Produces:
  - `interface OvertureMatch { account_number: string; site_number: string | null; matched: number; gers_id: string | null; matched_name: string | null; score: number | null; distance_m: number | null; website: string | null; has_facebook: number; has_instagram: number; phone: string | null; }`
  - `interface PresenceFacts { has_website: boolean; website_url: string | null; has_facebook_page: boolean; has_instagram: boolean; phone: string | null; }`
  - `applyOvertureMatch(base: PresenceFacts, match: OvertureMatch | null): PresenceFacts`
  - `fetchOvertureMatch(db: D1Database, accountNumber: string | null, siteNumber: string | null): Promise<OvertureMatch | null>`

- [ ] **Step 1: Write the failing tests**

Append to `api/test/overture.test.ts`:

```typescript
import { applyOvertureMatch, fetchOvertureMatch, type OvertureMatch, type PresenceFacts } from '../src/lib/overture';

const bare: PresenceFacts = {
  has_website: false, website_url: null, has_facebook_page: false, has_instagram: false, phone: null,
};
const match = (over: Partial<OvertureMatch> = {}): OvertureMatch => ({
  account_number: '478849', site_number: '1', matched: 1, gers_id: 'g1', matched_name: 'Shop',
  score: 0.9, distance_m: 12, website: null, has_facebook: 0, has_instagram: 0, phone: null, ...over,
});

describe('applyOvertureMatch', () => {
  it('adds a website Google did not find', () => {
    // Overture carries 55 websites to Google's 23 on the measured sample, 40 of them Overture-only,
    // and the website term is 30 of the deficit's 100 points.
    const out = applyOvertureMatch(bare, match({ website: 'http://shop.com' }));
    expect(out.has_website).toBe(true);
    expect(out.website_url).toBe('http://shop.com');
  });

  it('never downgrades a website Google did find', () => {
    const base = { ...bare, has_website: true, website_url: 'http://google-found.com' };
    const out = applyOvertureMatch(base, match({ website: null }));
    expect(out.has_website).toBe(true);
    expect(out.website_url).toBe('http://google-found.com');
  });

  it('prefers the live Google URL when both sources have one', () => {
    const base = { ...bare, has_website: true, website_url: 'http://google-found.com' };
    const out = applyOvertureMatch(base, match({ website: 'http://overture-found.com' }));
    expect(out.website_url).toBe('http://google-found.com');
  });

  it('supplies social presence, which Google never reports', () => {
    // This is what stops computeDigitalDeficit's +12 firing for every business alike: 60 of
    // Overture's 74 matches carry a social link where Google carries none at all.
    const out = applyOvertureMatch(bare, match({ has_facebook: 1, has_instagram: 1 }));
    expect(out.has_facebook_page).toBe(true);
    expect(out.has_instagram).toBe(true);
  });

  it('adds nothing for a row the build found no match for', () => {
    expect(applyOvertureMatch(bare, match({ matched: 0, website: 'http://stale.com' }))).toEqual(bare);
  });

  it('adds nothing when the build has not covered the business', () => {
    expect(applyOvertureMatch(bare, null)).toEqual(bare);
  });

  it('fills a phone the live lookup missed without overwriting one it found', () => {
    expect(applyOvertureMatch(bare, match({ phone: '773-555-0000' })).phone).toBe('773-555-0000');
    const base = { ...bare, phone: '773-555-1111' };
    expect(applyOvertureMatch(base, match({ phone: '773-555-0000' })).phone).toBe('773-555-1111');
  });
});

describe('fetchOvertureMatch', () => {
  it('finds the row for a licence account', async () => {
    await env.DB.prepare(
      `INSERT INTO overture_matches (account_number, site_number, matched, website, built_at)
       VALUES ('478849', '1', 1, 'http://shop.com', '2026-09-25T00:00:00Z')`,
    ).run();
    const found = await fetchOvertureMatch(env.DB, '478849', '1');
    expect(found?.website).toBe('http://shop.com');
  });

  it('returns null for an account with no row and for a licence with no account number', async () => {
    expect(await fetchOvertureMatch(env.DB, '999999', '1')).toBeNull();
    expect(await fetchOvertureMatch(env.DB, null, null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run test/overture.test.ts`
Expected: FAIL — cannot resolve `../src/lib/overture`.

- [ ] **Step 3: Implement the module**

Create `api/src/lib/overture.ts`:

```typescript
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
export function applyOvertureMatch(base: PresenceFacts, match: OvertureMatch | null): PresenceFacts {
  // matched = 0 means the build looked and Overture had nothing; a null match means it has not
  // covered this business yet. Neither contributes evidence, and the columns of a no-match row are
  // empty anyway — this guard makes that explicit rather than incidental.
  if (!match || match.matched !== 1) return base;
  return {
    has_website: base.has_website || match.website !== null,
    // Google's URL is fetched live where Overture's is up to a month old, so it leads.
    website_url: base.website_url ?? match.website,
    has_facebook_page: base.has_facebook_page || match.has_facebook === 1,
    has_instagram: base.has_instagram || match.has_instagram === 1,
    phone: base.phone ?? match.phone,
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
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd api && npm run typecheck && npx vitest run test/overture.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/overture.ts api/test/overture.test.ts
git commit -m "feat(api): never-downgrade Overture overlay

One pure function shared by the ingest path and the backfill, so the merge rule cannot
drift between them -- a drift would be invisible, surfacing only as businesses scored
on different evidence depending on when they were discovered. Google leads on website
URL and phone because those are fetched live; Overture supplies social presence, which
Google does not report at all."
```

---

### Task 6: Compose at ingest

**Files:**
- Modify: `api/src/lib/discovery.ts`
- Modify: `api/test/discovery.test.ts`

**Interfaces:**
- Consumes: `applyOvertureMatch`, `fetchOvertureMatch`, `type PresenceFacts` from `./overture` (Task 5).
- Produces: no new exports. `runDiscovery`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `api/test/discovery.test.ts`, in a new describe block:

```typescript
describe('composition with the precomputed Overture matches', () => {
  const overtureRow = async (over: Record<string, unknown> = {}) => {
    const row = {
      account_number: '478849', site_number: '1', matched: 1, website: null,
      has_facebook: 0, has_instagram: 0, phone: null, ...over,
    };
    await env.DB.prepare(
      `INSERT INTO overture_matches (account_number, site_number, matched, website,
         has_facebook, has_instagram, phone, built_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '2026-09-25T00:00:00Z')`,
    ).bind(row.account_number, row.site_number, row.matched, row.website,
           row.has_facebook, row.has_instagram, row.phone).run();
  };

  it('turns off the blanket social penalty when Overture has a social link', async () => {
    // Google reports no social presence at all, so before this every business paid
    // computeDigitalDeficit's +12 alike. 19 - 12 = 7.
    await overtureRow({ has_facebook: 1 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(7);

    const presence = await env.DB.prepare(
      'SELECT has_facebook_page, has_instagram FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    expect(presence).toEqual({ has_facebook_page: 1, has_instagram: 0 });
  });

  it('credits a website Google missed', async () => {
    // Google finds no website here; Overture does. 64 - 30 (website) = 34.
    await overtureRow({ website: 'http://overture-found.com' });
    routeGoogle([SOCRATA_ROW], { status: 'ZERO_RESULTS', candidates: [] });
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(34);

    const presence = await env.DB.prepare(
      'SELECT has_website, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://overture-found.com' });
  });

  it('keeps Google as the only source of rating and review count', async () => {
    await overtureRow({ website: 'http://overture-found.com', has_instagram: 1 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    const presence = await env.DB.prepare(
      'SELECT google_avg_rating, google_review_count, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(discovered[0].id).first();
    // Google's live URL wins over Overture's; the rating is Google's because Overture has none.
    expect(presence).toEqual({
      google_avg_rating: 4.5, google_review_count: 47, website_url: 'http://johnsbarbershop.com',
    });
  });

  it('scores a business the build found no Overture match for exactly as before', async () => {
    await overtureRow({ matched: 0 });
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(19);
  });

  it('scores a business the build has not covered exactly as before', async () => {
    routeGoogle();
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5);
    expect(discovered[0].digital_deficit_score).toBe(19);
  });

  it('still withholds a deficit when the live lookup never happened', async () => {
    // Overture data must not make an unlooked-up business look researched: a null deficit means
    // "not measured", and an offline match is not a measurement of the live source.
    await overtureRow({ website: 'http://overture-found.com', has_facebook: 1 });
    const health = newPlacesHealth();
    routeGoogle([SOCRATA_ROW], { status: 'REQUEST_DENIED' });
    const discovered = await runDiscovery(keyed, '60619', 'barbershops', 5, health);
    expect(discovered[0].digital_deficit_score).toBeNull();
    expect(health.unavailable).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run test/discovery.test.ts -t 'precomputed Overture'`
Expected: FAIL — deficits still 19 / 64, presence social flags still 0.

- [ ] **Step 3: Apply the overlay in `enrichAndPersist`**

In `api/src/lib/discovery.ts`, add to the imports:

```typescript
import { applyOvertureMatch, fetchOvertureMatch, type PresenceFacts } from './overture';
```

Then replace the block that derives `hasWebsite` / `hasFacebook` / `hasInstagram` (currently the lines from `const hasWebsite = enrichment.has_website ?? false;` through `const hasInstagram = false;`) with:

```typescript
  // Google reports no social presence and finds under half the websites Overture does, so the
  // precomputed match is overlaid before anything is scored (ADR 030 slice 2). The overlay never
  // downgrades: whatever the live lookup established stands.
  const overture = await fetchOvertureMatch(env.DB, bizData.account_number, bizData.site_number);
  const live: PresenceFacts = {
    has_website: enrichment.has_website ?? false,
    website_url: enrichment.website ?? null,
    has_facebook_page: false,
    has_instagram: false,
    phone: enrichment.phone ?? null,
  };
  const facts = applyOvertureMatch(live, overture);

  const hasWebsite = facts.has_website;
  const hasFacebook = facts.has_facebook_page;
  const hasInstagram = facts.has_instagram;
  // null when no corroborated match was found, 0 when Google returned a place that genuinely has no
  // reviews. computeDigitalDeficit charges +10 for a zero count and skips the term on null, and only
  // a business we actually looked up has earned that charge. Overture carries neither field.
  const googleReviewCount = enrichment.google_review_count ?? null;
  const hasGbp = enrichment.has_google_business_profile ?? false;
```

- [ ] **Step 4: Use the merged values in both writes**

In the same function, change the `businesses` insert's phone bind from `enrichment.phone ?? null` to `facts.phone`, and the `digital_presences` insert's `website_url` bind from `enrichment.website ?? null` to `facts.website_url`.

Leave the `google_avg_rating` bind as `enrichment.google_avg_rating ?? null` — Overture carries no rating, so there is nothing to overlay.

- [ ] **Step 5: Run to verify they pass**

Run: `cd api && npm run typecheck && npx vitest run`
Expected: all tests pass, including the six new ones.

If `scores a business the build has not covered exactly as before` fails with a deficit of 7 rather than 19, the overlay is treating a null match as evidence — check the `!match || match.matched !== 1` guard in `applyOvertureMatch`.

- [ ] **Step 6: Commit**

```bash
git add api/src/lib/discovery.ts api/test/discovery.test.ts
git commit -m "feat(api): overlay the precomputed Overture match at ingest

Discovery now reads overture_matches by the licence account it already holds -- one
indexed D1 read, no subrequest -- and overlays it before scoring. This is what stops
computeDigitalDeficit's +12 social term firing for every business alike, without
editing a scorer pinned to Python: a matched business with a social link stores a real
1. A business the build found nothing for, or has not covered, scores exactly as it did
before, and an unlooked-up business still gets a null deficit -- an offline match is
not a measurement of the live source."
```

---

### Task 7: The backfill route

**Files:**
- Create: `api/src/routes/enrichment.ts`
- Modify: `api/src/index.ts`
- Create: `api/test/enrichment-backfill.test.ts`

**Interfaces:**
- Consumes: `applyOvertureMatch`, `type OvertureMatch`, `type PresenceFacts` from `../lib/overture`; `computeDigitalDeficit` from `../lib/scoring`; `requireAuth`, `requireAdmin` from `../middleware/auth`; `nowIso` from `../db/serialize`.
- Produces: `POST /api/enrichment/overture-backfill` returning `{ examined: number; updated: number; skipped: number }`.

- [ ] **Step 1: Write the failing tests**

Create `api/test/enrichment-backfill.test.ts`:

```typescript
// The backfill exists because a refresh of the Overture match table must improve businesses already
// stored, not only ones discovered afterwards. It runs inside the Worker so it calls the real
// computeDigitalDeficit: generating UPDATE statements offline would have meant a third copy of a
// scorer already pinned across Python and TypeScript.
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { accessToken, adminUser, api, resetDb, viewerUser } from './helpers';

beforeEach(async () => {
  await resetDb();
});

async function seed(opts: { website?: string | null; facebook?: number } = {}) {
  const businessId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO businesses (id, name, zip_code, niche, account_number, site_number)
     VALUES (?, 'Test Shop', '60619', 'barbershops', '478849', '1')`,
  ).bind(businessId).run();
  await env.DB.prepare(
    `INSERT INTO digital_presences (id, business_id, has_website, has_google_business_profile,
       google_review_count, has_facebook_page, has_instagram, created_at, updated_at)
     VALUES (?, ?, 0, 1, 47, 0, 0, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  ).bind(crypto.randomUUID(), businessId).run();
  await env.DB.prepare(
    `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score,
       composite_acquisition_score, created_at, updated_at)
     VALUES (?, ?, 1, 49, 49, '2026-09-25T00:00:00Z', '2026-09-25T00:00:00Z')`,
  ).bind(crypto.randomUUID(), businessId).run();
  await env.DB.prepare(
    `INSERT INTO overture_matches (account_number, site_number, matched, website,
       has_facebook, has_instagram, built_at)
     VALUES ('478849', '1', 1, ?, ?, 0, '2026-09-25T00:00:00Z')`,
  ).bind(opts.website ?? null, opts.facebook ?? 0).run();
  return businessId;
}

const run = async (limit = 50) => {
  const token = await accessToken(await adminUser());
  const res = await api('POST', '/enrichment/overture-backfill', { token, json: { limit } });
  return { res, body: (await res.json()) as { examined: number; updated: number; skipped: number } };
};

describe('POST /api/enrichment/overture-backfill', () => {
  it('rejects an anonymous request and a viewer', async () => {
    expect((await api('POST', '/enrichment/overture-backfill', { json: {} })).status).toBe(401);
    const token = await accessToken(await viewerUser());
    expect((await api('POST', '/enrichment/overture-backfill', { token, json: {} })).status).toBe(403);
  });

  it('adds a website Overture has and the stored row lacks', async () => {
    const businessId = await seed({ website: 'http://found.com' });
    const { body } = await run();
    expect(body).toEqual({ examined: 1, updated: 1, skipped: 0 });

    const presence = await env.DB.prepare(
      'SELECT has_website, website_url FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://found.com' });
  });

  it('writes a NEW score version and leaves the old one intact', async () => {
    // Scores are append-only (ADR 014, 017), and both LATEST_SCORE_JOIN and sentiment-feedback read
    // score_version DESC, so a new row is what makes the improvement visible.
    const businessId = await seed({ website: 'http://found.com' });
    await run();

    const scores = await env.DB.prepare(
      'SELECT score_version, digital_deficit_score FROM lead_scores WHERE business_id = ? ORDER BY score_version',
    ).bind(businessId).all<{ score_version: number; digital_deficit_score: number }>();
    expect(scores.results.map((s) => s.score_version)).toEqual([1, 2]);
    expect(scores.results[0].digital_deficit_score).toBe(49);
    // website (0) + GBP (0) + 47 reviews (0) + no social (12) + no ads (7) = 19
    expect(scores.results[1].digital_deficit_score).toBe(19);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    await seed({ website: 'http://found.com' });
    expect((await run()).body.updated).toBe(1);
    expect((await run()).body).toEqual({ examined: 0, updated: 0, skipped: 0 });
  });

  it('never downgrades a website already stored', async () => {
    const businessId = await seed({ website: null, facebook: 1 });
    await env.DB.prepare(
      "UPDATE digital_presences SET has_website = 1, website_url = 'http://kept.com' WHERE business_id = ?",
    ).bind(businessId).run();

    await run();
    const presence = await env.DB.prepare(
      'SELECT has_website, website_url, has_facebook_page FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 1, website_url: 'http://kept.com', has_facebook_page: 1 });
  });

  it('ignores a business whose build found no match', async () => {
    const businessId = await seed({ website: 'http://found.com' });
    await env.DB.prepare('UPDATE overture_matches SET matched = 0').run();
    expect((await run()).body).toEqual({ examined: 0, updated: 0, skipped: 0 });
    const presence = await env.DB.prepare(
      'SELECT has_website FROM digital_presences WHERE business_id = ?',
    ).bind(businessId).first();
    expect(presence).toEqual({ has_website: 0 });
  });

  it('rejects a limit above the cap', async () => {
    const token = await accessToken(await adminUser());
    const res = await api('POST', '/enrichment/overture-backfill', { token, json: { limit: 5000 } });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd api && npx vitest run test/enrichment-backfill.test.ts`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Write the route**

Create `api/src/routes/enrichment.ts`:

```typescript
// Applies a refreshed Overture match table to businesses already stored (ADR 030 slice 2).
//
// Python has no HTTP route for this either — its equivalent work runs from the Typer CLI — so this
// is the Workers stand-in, exactly as POST /api/discovery/run is. It lives in the Worker rather than
// in the offline build script for one reason: it must call the real computeDigitalDeficit, and a
// scorer already pinned across Python and TypeScript must not get a third implementation.
import { Hono } from 'hono';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../middleware/auth';
import { applyOvertureMatch, type OvertureMatch, type PresenceFacts } from '../lib/overture';
import { computeDigitalDeficit } from '../lib/scoring';
import { nowIso } from '../db/serialize';
import { jsonBody } from '../lib/validate';
import type { AppEnv } from '../types';

const router = new Hono<AppEnv>();

const MAX_LIMIT = 500;

const backfillSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50),
});

interface Candidate extends OvertureMatch {
  business_id: string;
  presence_id: string;
  stored_has_website: number;
  stored_website_url: string | null;
  stored_has_facebook: number;
  stored_has_instagram: number;
  stored_phone: string | null;
  stored_gbp: number;
  stored_review_count: number | null;
  latest_version: number;
}

router.post('/overture-backfill', requireAuth, requireAdmin, jsonBody(backfillSchema), async (c) => {
  const { limit } = c.req.valid('json');

  // The WHERE clause is the idempotency mechanism: it selects only businesses the match would ADD
  // something to, so a second run finds nothing. `site_number IS` rather than `=` because `=` yields
  // NULL for a null site number and the join would silently miss those rows.
  const candidates = await c.env.DB.prepare(
    `SELECT b.id AS business_id, dp.id AS presence_id,
            dp.has_website AS stored_has_website, dp.website_url AS stored_website_url,
            dp.has_facebook_page AS stored_has_facebook, dp.has_instagram AS stored_has_instagram,
            dp.has_google_business_profile AS stored_gbp,
            dp.google_review_count AS stored_review_count,
            b.phone AS stored_phone,
            om.account_number, om.site_number, om.matched, om.gers_id, om.matched_name,
            om.score, om.distance_m, om.website, om.has_facebook, om.has_instagram, om.phone,
            (SELECT COALESCE(MAX(score_version), 0) FROM lead_scores WHERE business_id = b.id)
              AS latest_version
       FROM businesses b
       JOIN digital_presences dp ON dp.business_id = b.id
       JOIN overture_matches om
         ON om.account_number = b.account_number AND om.site_number IS b.site_number
      WHERE om.matched = 1
        AND ( (dp.has_website = 0 AND om.website IS NOT NULL)
           OR (dp.has_facebook_page = 0 AND om.has_facebook = 1)
           OR (dp.has_instagram = 0 AND om.has_instagram = 1) )
      LIMIT ?`,
  )
    .bind(limit)
    .all<Candidate>();

  let updated = 0;
  let skipped = 0;
  const timestamp = nowIso();

  for (const row of candidates.results) {
    const stored: PresenceFacts = {
      has_website: row.stored_has_website === 1,
      website_url: row.stored_website_url,
      has_facebook_page: row.stored_has_facebook === 1,
      has_instagram: row.stored_has_instagram === 1,
      phone: row.stored_phone,
    };
    const facts = applyOvertureMatch(stored, row);
    if (
      facts.has_website === stored.has_website &&
      facts.has_facebook_page === stored.has_facebook_page &&
      facts.has_instagram === stored.has_instagram
    ) {
      skipped += 1;
      continue;
    }

    // Recomputed from the merged row, by the same function discovery uses. has_facebook_page and
    // has_instagram are the terms this backfill exists to correct: Google reports neither, so before
    // the overlay every business alike paid the +12 "no social presence" penalty.
    const deficit = computeDigitalDeficit({
      has_website: facts.has_website ? 1 : 0,
      website_url: facts.website_url,
      website_quality_score: null,
      has_ssl: null,
      has_google_business_profile: row.stored_gbp,
      gbp_completeness_score: null,
      google_review_count: row.stored_review_count,
      has_facebook_page: facts.has_facebook_page ? 1 : 0,
      has_instagram: facts.has_instagram ? 1 : 0,
      fb_last_post_days_ago: null,
      has_google_ads: 0,
      has_meta_ads: 0,
    } as Parameters<typeof computeDigitalDeficit>[0]);

    // Composite is the deficit alone: the other sub-scores need a competitive context that does not
    // exist yet, which is the same Phase 1 shape runDiscovery writes.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE digital_presences SET has_website = ?, website_url = ?, has_facebook_page = ?,
           has_instagram = ?, updated_at = ? WHERE id = ?`,
      ).bind(
        facts.has_website ? 1 : 0,
        facts.website_url,
        facts.has_facebook_page ? 1 : 0,
        facts.has_instagram ? 1 : 0,
        timestamp,
        row.presence_id,
      ),
      c.env.DB.prepare('UPDATE businesses SET phone = ?, updated_at = ? WHERE id = ?').bind(
        facts.phone,
        timestamp,
        row.business_id,
      ),
      c.env.DB.prepare(
        `INSERT INTO lead_scores (id, business_id, score_version, digital_deficit_score,
           composite_acquisition_score, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        row.business_id,
        row.latest_version + 1,
        deficit,
        deficit,
        timestamp,
        timestamp,
      ),
    ]);
    updated += 1;
  }

  console.log('overture_backfill', { examined: candidates.results.length, updated, skipped });
  return c.json({ examined: candidates.results.length, updated, skipped });
});

export default router;
```

- [ ] **Step 4: Mount the router**

In `api/src/index.ts`, add the import beside the other route imports and mount it next to the discovery route:

```typescript
import enrichment from './routes/enrichment';
```

```typescript
app.route('/api/enrichment', enrichment);
```

Match the surrounding style exactly — read the neighbouring `app.route` calls first.

- [ ] **Step 5: Run to verify they pass**

Run: `cd api && npm run typecheck && npx vitest run`
Expected: all tests pass, including the seven new ones.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/enrichment.ts api/src/index.ts api/test/enrichment-backfill.test.ts
git commit -m "feat(api): admin route to backfill stored businesses from Overture

A refresh of the match table has to improve businesses already stored, not only ones
discovered afterwards. The WHERE clause selects only businesses the match would ADD
something to, which is what makes the route idempotent. Runs in the Worker so it calls
the real computeDigitalDeficit, and writes a NEW versioned lead_scores row rather than
overwriting -- scores are append-only and readers select score_version DESC."
```

---

### Task 8: Load production and document

**Files:**
- Modify: `.claude/CLAUDE.md`
- Modify: `docs/vault/030-places-composition-licence-identity.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Apply migration 0004 to the remote database**

```bash
cd api && npx wrangler d1 migrations apply leadforge-db --remote
```
Expected: `0004_overture_matches.sql` listed and applied. Additive, so the deployed Worker is unaffected until it is redeployed.

- [ ] **Step 2: Load the match rows into production**

```bash
cd /Volumes/Containers/LeadForge
for f in /tmp/ov/overture_matches.*.sql; do
  (cd api && npx wrangler d1 execute leadforge-db --remote --file="$f") || break
done
cd api && npx wrangler d1 execute leadforge-db --remote \
  --command "SELECT COUNT(*) AS n, SUM(matched) AS matched FROM overture_matches"
```
Expected: the same counts Task 4 Step 4 produced locally. ~21k writes, a fifth of the 100,000/day free-tier budget — if a later step reports a row-write limit error, wait for midnight UTC rather than retrying.

- [ ] **Step 3: Deploy**

```bash
cd api && npx wrangler deploy
```
Expected: a new version id. The bundle grows by nothing measurable — `overture.ts` is small and there is no new asset.

- [ ] **Step 4: Run the backfill against the businesses already stored**

```bash
cd /Volumes/Containers/LeadForge
# A heredoc into `node -` is parsed as CommonJS and would fail on `import`, so write a real file.
cat > /tmp/backfill.mjs <<'EOF'
import fs from 'node:fs';
const env = fs.readFileSync('.env', 'utf8');
const pick = (k) => env.split('\n').find((l) => l.startsWith(k + '=')).split('=')[1].trim();
const API = 'https://leadforge-api.crichalchemist.workers.dev/api';
const login = await fetch(API + '/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'crichalchemist@gmail.com', password: pick('ADMIN_PASSWORD') }),
});
const { access_token } = await login.json();
const res = await fetch(API + '/enrichment/overture-backfill', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer ' + access_token },
  body: JSON.stringify({ limit: 500 }),
});
console.log(res.status, JSON.stringify(await res.json()));
EOF
node /tmp/backfill.mjs
```
Expected: `200 {"examined":N,"updated":M,"skipped":...}`. Run it again and expect `{"examined":0,"updated":0,"skipped":0}` — that is the idempotency check against production, not just against the test suite.

- [ ] **Step 5: Update the Data sources section of `.claude/CLAUDE.md`**

Replace the two adoption blockers recorded under the Overture paragraph — they are both resolved and the file still presents them as open. Insert after the head-to-head table paragraph:

```markdown
**Overture is composed in as of 2026-09-25** (ADR 030 slice 2, spec
`docs/superpowers/specs/2026-09-25-overture-composition-design.md`). It is a precomputed match
table, never a live source and never a POI mirror: Workers has no DuckDB, and Chicago's 214,735
places against D1's 100,000 row/day free-tier write budget would take three days to load and three
more on every refresh. `scripts/build_overture_matches.py` matches all 21,004 licensed Chicago
businesses offline and writes only the result to `overture_matches` (migration 0004), keyed on the
licence account. Rebuilds are wholesale, which is what makes Overture GERS id stability across
monthly releases irrelevant — the earlier blocker. Refresh is always a local or CI action; it cannot
be a Workers cron because of the DuckDB dependency.

`lib/overture.ts` holds one never-downgrade overlay used by both `lib/discovery.ts` at ingest and
`POST /api/enrichment/overture-backfill` for businesses already stored, so the merge rule cannot
drift between them. Google leads on website URL and phone (fetched live); Overture supplies social
presence, which Google does not report at all; rating and review count are Google's alone. A row with
`matched = 0` means the build found nothing, and no row means the build has not covered that business
— the two must stay distinguishable.

This repairs the blanket +12 social penalty without touching the Python-pinned scorer: a matched
business with a social link now stores a real 1. Residual, unchanged: a business with no Overture
match still stores 0 and still pays +12, because the column is `INTEGER NOT NULL DEFAULT 0` and
cannot express "unknown".
```

- [ ] **Step 6: Record the outcome in ADR 030**

Append to `docs/vault/030-places-composition-licence-identity.md`:

```markdown
## Slice 2 landed (2026-09-25)

Overture is composed in, per `docs/superpowers/specs/2026-09-25-overture-composition-design.md`.
Both blockers this ADR left open are closed: the dedup key was already the licence account, and GERS
id stability stopped mattering because rebuilds are wholesale — no row outlives one.

Recorded for whoever lands the voice port: the backfill writes a fresh `lead_scores` version, which
supersedes any sentiment adjustment on the previous latest score. That is inert while no call has
run and `call_attempts` is never incremented, but recalibration will have to decide whether to
replay adjustments.
```

- [ ] **Step 7: Commit**

```bash
git add .claude/CLAUDE.md docs/vault/030-places-composition-licence-identity.md
git commit -m "docs: record that Overture is composed in

Both of ADR 030's adoption blockers are closed: identity was already the licence
account, and wholesale rebuilds make GERS id stability across monthly releases
irrelevant. Notes what did not change -- an unmatched business still pays the +12
social penalty, because the column cannot express unknown -- and flags for the voice
port that a backfill supersedes any sentiment adjustment on the previous score."
```

---

## Verification

After Task 8, all of the following must hold:

- `cd api && npm run typecheck` clean, `npx vitest run` all passing.
- A second backfill against production returns `{"examined":0,"updated":0,"skipped":0}`.
- `SELECT COUNT(*), SUM(matched) FROM overture_matches` on the remote database matches the local counts.
- A fresh discovery run in a ZIP with Overture coverage shows deficits lower than the Google-only run recorded in ADR 030 for businesses with a social link.
- `diff` on `api/test/fixtures/name-match-vectors.json` against its pre-Task-2 copy shows no change.
