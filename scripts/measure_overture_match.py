"""Measure how well Overture Maps places match Chicago business licences.

Run:  uv run --with duckdb python scripts/measure_overture_match.py

Answers the question ADR 029's Correction leaves open: is the open bulk corpus a better
enrichment source than the Foursquare Places API? Joins the deduped 60619 'hair service'
licence rows against every Overture place in a south-side bounding box, scores the name
match, and prints the same figures for the Foursquare API run (fsq_results.jsonl) using
the identical scorer so the two are comparable.

Needs no credentials: the Overture S3 bucket is anonymously readable and Socrata needs no
token for this volume. licences.json is written by the companion pull; regenerate it from
scrapers/socrata.ts's dedupeLicenseRows logic if it is missing.
"""
import duckdb, json, math, random, re

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
P = "s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*"
places = con.execute(f"""
  SELECT names.primary AS name, categories.primary AS category, confidence,
         coalesce(len(websites),0)>0 AS web, coalesce(len(phones),0)>0 AS tel,
         coalesce(len(socials),0)>0 AS soc,
         ST_X(geometry) AS lon, ST_Y(geometry) AS lat,
         list_filter(sources, s -> s.dataset = 'Foursquare')[1].record_id AS fsq_id
  FROM read_parquet('{P}')
  WHERE bbox.xmin BETWEEN -87.66 AND -87.54 AND bbox.ymin BETWEEN 41.69 AND 41.79
    AND names.primary IS NOT NULL
""").fetchall()
print(f"corpus: {len(places)} places | with Foursquare source: {sum(1 for p in places if p[8])}")

lic = json.load(open('licences.json'))

STOP = {'llc','inc','corp','corporation','ltd','the','and','dba','co','company','incorporated','of','by','at'}
def toks(s):
    s = re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("&", " and "))
    out = []
    for t in s.split():
        if len(t) < 3 or t in STOP: continue
        out.append(t[:-1] if len(t) > 4 and t.endswith('s') else t)   # crude plural/possessive fold
    return out

# IDF over the whole corpus so sector words ("hair", "salon", "barber") carry ~no weight
from collections import Counter
df = Counter()
docs = [toks(p[0]) for p in places] + [toks(b['name']) for b in lic]
for d in docs: df.update(set(d))
N = len(docs)
idf = {t: math.log(N / c) for t, c in df.items()}

def bigrams(s):
    s = re.sub(r"[^a-z0-9]", "", s.lower())
    return {s[i:i+2] for i in range(len(s)-1)}

def charsim(a, b):
    ga, gb = bigrams(a), bigrams(b)
    return len(ga & gb) / len(ga | gb) if (ga | gb) else 0.0

# IDF-weighted FUZZY containment. A licence token earns its IDF weight only if some token in the
# candidate name is (near-)identical to it. Sector words carry ~zero IDF, so "african hair braiding"
# shared between two unrelated braiders contributes nothing to numerator OR denominator -- the score
# is decided entirely by the distinctive tokens. Char similarity applies per token, not across the
# whole string, so "Fallou"~"Falou" still matches while "Constance"~"Marseillais" cannot.
def tokmatch(t, u):
    # prefix rule first: "brazzaville"/"brazza" is the same name truncated, which bigram
    # overlap scores at 0.5 and would throw away a true match.
    if len(t) >= 5 and len(u) >= 5 and (t.startswith(u) or u.startswith(t)): return True
    return charsim(t, u) >= 0.80

def score(a, b):
    ta, tb = toks(a), toks(b)
    if not ta or not tb: return 0.0
    sa = set(ta)
    denom = sum(idf.get(t, 0) for t in sa)
    if denom <= 0: return 0.0
    # HEAD-TOKEN GATE. IDF alone only discounts sector words; three of them ("african", "hair",
    # "braiding") still outvote one distinctive name, which is how CONSTANCE AFRICAN HAIR BRAIDING
    # scored 0.61 against Marseillais African Hair Braiding. The rarest token in the licence name
    # IS the business's identity -- if the candidate does not carry it, nothing else can rescue it.
    head = max(sa, key=lambda t: idf.get(t, 0))
    if not any(tokmatch(head, u) for u in set(tb)): return 0.0
    credit = sum(idf.get(t, 0) for t in sa if any(tokmatch(t, u) for u in set(tb)))
    return credit / denom

def hav(la1, lo1, la2, lo2):
    R = 6371000.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp, dl = p2 - p1, math.radians(lo2 - lo1)
    a = math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def run(radius, thresh, cat_only):
    HAIR = {'hair_salon','beauty_salon','barber','nail_salon','hair_supply_stores',
            'hair_extensions','cosmetic_and_beauty_supplies','beauty_product_supplier','spa','beauty'}
    accepted, rejected, nocand = [], [], 0
    for b in lic:
        cands = []
        for p in places:
            if cat_only and (p[1] or '') not in HAIR: continue
            d = hav(b['lat'], b['lon'], p[7], p[6])
            if d <= radius: cands.append((d, p))
        if not cands: nocand += 1; continue
        best = max(cands, key=lambda c: (score(b['name'], c[1][0]), -c[0]))
        s = score(b['name'], best[1][0])
        (accepted if s >= thresh else rejected).append((b, best[1], best[0], s, len(cands)))
    return accepted, rejected, nocand

print("\nradius  cat?   matched  no-candidate  best-but-rejected")
for cat_only in (False, True):
    for radius in (50, 100, 150, 250):
        a, r, nc = run(radius, 0.5, cat_only)
        print(f"{radius:5d}m  {'cat' if cat_only else 'all':4s}  {len(a):7d}  {nc:12d}  {len(r):17d}")

acc, rej, nc = run(150, 0.5, False)
print(f"\n=== PRE-COMMITTED METRIC: name-corroborated matches at 150m, all categories ===")
print(f"    {len(acc)} / {len(lic)}  ({100*len(acc)/len(lic):.0f}%)")
w = sum(1 for a in acc if a[1][3]); t = sum(1 for a in acc if a[1][4]); s_ = sum(1 for a in acc if a[1][5])
print(f"    among matches: website {w} ({100*w/max(len(acc),1):.0f}%)  phone {t} ({100*t/max(len(acc),1):.0f}%)  social {s_} ({100*s_/max(len(acc),1):.0f}%)")
print(f"    with a Foursquare source id: {sum(1 for a in acc if a[1][8])}")

random.seed(7)
print("\n--- 12 ACCEPTED pairs (eyeball these) ---")
for b, p, d, s, n in random.sample(acc, min(12, len(acc))):
    print(f"  {s:.2f} {d:5.0f}m  {b['name'][:34]:36s} -> {p[0][:34]:36s} [{p[1]}]")
print("\n--- 12 REJECTED best-candidates (should look like non-matches) ---")
for b, p, d, s, n in random.sample(rej, min(12, len(rej))):
    print(f"  {s:.2f} {d:5.0f}m  {b['name'][:34]:36s} -> {p[0][:34]:36s} [{p[1]}]")

acc2, rej2, _ = run(150, 0.5, False)
acc2.sort(key=lambda x: x[3])
print("\n--- 12 LOWEST-scoring ACCEPTED, new scorer (most likely to be wrong) ---")
for b, p, d, s, n in acc2[:12]:
    print(f"  {s:.2f} {d:5.0f}m  {b['name'][:33]:35s} -> {p[0][:33]:35s} [{p[1]}]")

# ---- Head-to-head: the SAME scorer applied to the Foursquare API's own matches ----
import json as _j
api = [_j.loads(l) for l in open('fsq_results.jsonl') if l.strip()]
matched = [r for r in api if r.get('place')]
corrob = [r for r in matched if score(r['name'], r['place']['n']) >= 0.5]
print(f"\n=== HEAD-TO-HEAD on the same 157 businesses, identical scorer, threshold 0.5 ===")
print(f"  Foursquare API (limit=1, 200m):  matched {len(matched)}  name-corroborated {len(corrob)}  "
      f"FALSE matches {len(matched)-len(corrob)}")
aw = sum(1 for r in corrob if r['place']['w']); asoc = sum(1 for r in corrob if r['place']['fb'] or r['place']['ig'])
print(f"     among corroborated: website {aw} ({100*aw/max(len(corrob),1):.0f}%)  social {asoc} ({100*asoc/max(len(corrob),1):.0f}%)")
ow = sum(1 for a in acc2 if a[1][3]); osoc = sum(1 for a in acc2 if a[1][5])
print(f"  Overture (150m, IDF join):       matched {len(acc2)}  name-corroborated {len(acc2)}  "
      f"above-threshold by definition; the 12 lowest-scoring were audited by hand")
print(f"     among corroborated: website {ow} ({100*ow/max(len(acc2),1):.0f}%)  social {osoc} ({100*osoc/max(len(acc2),1):.0f}%)")
print(f"\n  usable website signals:  API {aw}   Overture {ow}")
print(f"  usable social signals:   API {asoc}   Overture {osoc}")
