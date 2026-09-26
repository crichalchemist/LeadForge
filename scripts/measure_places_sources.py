"""Three-way head-to-head: Google Places (legacy), Foursquare API, Overture Maps.

One name scorer, one candidate corpus, one 200 m radius, the same 157 licensed 'hair service'
businesses in 60619. Answers the question ADR 029 could not while Google billing was broken:
now that it works again, which source -- or which combination -- should enrich discovery?

Run:  node scripts/fetch_places_candidates.mjs licences   <dir>
      node scripts/fetch_places_candidates.mjs google     <dir>
      node scripts/fetch_places_candidates.mjs foursquare <dir>
      uv run --with duckdb python scripts/measure_places_sources.py <dir>

The scorer is reconciled with scripts/measure_overture_match.py: toks, bigrams, charsim, tokmatch
and score are behaviourally identical (that file routes '&' to the STOP-listed token "and" where
this one drops it as a separator, and its empty-bigram branch is unreachable because tokens are
always >= 3 chars). On this corpus it reproduces that script's headline 74 at both 150 m and 200 m.

Businesses are keyed by the city's account_number/site_number, NOT by name. Five names in the 157
are held by two or three different licence accounts, so keying by name silently merged 6 businesses
and under-reported every source at once -- it is what made an earlier run of this script read 71
where the Overture-only run read 74. The fetchers write one ordered line per business, so results
pair positionally with the licence list; the script asserts that alignment rather than trusting it.

Caveat that survived into the numbers: Overture's "returned" column is 157 because every business
has some POI within 200 m, and matching is exhaustive and offline, so it has no "false match"
count comparable to the two APIs' single nearest result.
"""
import duckdb, json, math, sys

S = sys.argv[1]
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
P = "s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*"
TH, M, RADIUS = 0.50, 0.03, 200

biz = json.load(open(f"{S}/licences.json"))
def bkey(b): return f"{b['account_number']}/{b['site_number'] or ''}"
keys = [bkey(b) for b in biz]
assert len(set(keys)) == len(biz), "licence key is not unique -- dedup assumption broken"

def load(fname):
    recs = [json.loads(l) for l in open(f"{S}/{fname}") if l.strip()]
    assert len(recs) == len(biz) and all(r["name"] == b["name"] for r, b in zip(recs, biz)), \
        f"{fname} is not positionally aligned with licences.json -- refetch it"
    return dict(zip(keys, recs))

la = [b["latitude"] for b in biz]; lo = [b["longitude"] for b in biz]
rows = con.execute(f"""
  SELECT names.primary AS nm, ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
         len(coalesce(websites,[])) AS nweb, len(coalesce(socials,[])) AS nsoc,
         len(coalesce(phones,[])) AS nph
  FROM read_parquet('{P}', filename=false, hive_partitioning=1)
  WHERE bbox.ymin BETWEEN {min(la)-M} AND {max(la)+M}
    AND bbox.xmin BETWEEN {min(lo)-M} AND {max(lo)+M} AND names.primary IS NOT NULL""").fetchall()

sys.path.insert(0, "scripts")
from lib.name_match import build_idf, make_scorer, tokenize   # noqa: E402

STOP = {'llc','inc','corp','corporation','ltd','the','and','dba','co','company','incorporated','of','by','at'}
idf, default_idf = build_idf([r[0] for r in rows], STOP, extra=[b["name"] for b in biz])
score = make_scorer(STOP, idf, default_idf)
N = len(rows) + len(biz)
def hav(a, b, c, d):
    R, t = 6371000.0, math.pi / 180
    x, y = (c - a) * t, (d - b) * t
    h = math.sin(x/2)**2 + math.cos(a*t) * math.cos(c*t) * math.sin(y/2)**2
    return 2 * R * math.asin(math.sqrt(h))

# ---- Overture: best-scoring POI within RADIUS ----
ov, ov_ret = {}, 0
for b in biz:
    near, best = False, None
    for r in rows:
        if abs(r[1]-b["latitude"]) > 0.0025 or abs(r[2]-b["longitude"]) > 0.0033: continue
        if hav(b["latitude"], b["longitude"], r[1], r[2]) > RADIUS: continue
        near = True
        s = score(b["name"], r[0])
        if s >= TH and (best is None or s > best[0]): best = (s, r)
    if near: ov_ret += 1
    if best: ov[bkey(b)] = best

# ---- Google: same scorer, same cut. locationbias is a bias, not a filter, so cut on distance. ----
grecs = load("google_results.jsonl")
gin = {k: r for k, r in grecs.items()
       if r.get("place") and (r["place"].get("dist") is not None) and r["place"]["dist"] <= RADIUS}
gm = {k: (score(r["name"], r["place"]["n"]), r["place"]) for k, r in gin.items()}
gm = {k: v for k, v in gm.items() if v[0] >= TH}

# ---- Foursquare: entitled fields only; radius applied server-side at fetch. ----
frecs = load("fsq_results.jsonl")
fin = {k: r for k, r in frecs.items() if r.get("place")}
fm = {k: (score(r["name"], r["place"]["n"]), r["place"]) for k, r in fin.items()}
fm = {k: v for k, v in fm.items() if v[0] >= TH}

def pct(n): return f"{100*n/len(biz):.0f}%"
print(f"corpus: {len(rows)} overture POIs, {N} idf docs, threshold {TH}, radius {RADIUS}m, "
      f"{len(biz)} businesses keyed by licence account\n")
print(f"{'source':<12}{'returned':>9}{'corrob':>8}{'false':>7}{'website':>9}{'phone':>7}{'social':>8}{'rating':>8}{'rev>=5':>8}")
print(f"{'Google':<12}{len(gin):>9}{len(gm):>8}{len(gin)-len(gm):>7}"
      f"{sum(1 for s,p in gm.values() if p.get('site')):>9}"
      f"{sum(1 for s,p in gm.values() if p.get('phone')):>7}{'-':>8}"
      f"{sum(1 for s,p in gm.values() if p.get('rating') is not None):>8}"
      f"{sum(1 for s,p in gm.values() if (p.get('reviews') or 0) >= 5):>8}")
print(f"{'Foursquare':<12}{len(fin):>9}{len(fm):>8}{len(fin)-len(fm):>7}"
      f"{sum(1 for s,p in fm.values() if p.get('site')):>9}"
      f"{sum(1 for s,p in fm.values() if p.get('tel')):>7}"
      f"{sum(1 for s,p in fm.values() if p.get('fb') or p.get('ig') or p.get('tw')):>8}{0:>8}{0:>8}")
print(f"{'Overture':<12}{ov_ret:>9}{len(ov):>8}{'-':>7}"
      f"{sum(1 for s,r in ov.values() if r[3] > 0):>9}"
      f"{sum(1 for s,r in ov.values() if r[5] > 0):>7}"
      f"{sum(1 for s,r in ov.values() if r[4] > 0):>8}{0:>8}{0:>8}")
G, F, O = set(gm), set(fm), set(ov)
print(f"\ncoverage  google={len(G)} ({pct(len(G))})  foursquare={len(F)} ({pct(len(F))})  overture={len(O)} ({pct(len(O))})")
print(f"unions    G|O={len(G|O)} ({pct(len(G|O))})   G|F={len(G|F)}   F|O={len(F|O)}   all three={len(G|F|O)} ({pct(len(G|F|O))})")
print(f"overture misses covered by google: {len(G-O)}   google misses covered by overture: {len(O-G)}")
print(f"foursquare adds over G|O: {len(F-(G|O))}")
wg = {k for k, (s, p) in gm.items() if p.get('site')}
wo = {k for k, (s, r) in ov.items() if r[3] > 0}
print(f"website union G|O={len(wg|wo)} (google {len(wg)}, overture {len(wo)}, overture-only {len(wo-wg)})")
rat = {k for k, (s, p) in gm.items() if p.get('rating') is not None}
print(f"rating available on {len(rat)}/{len(biz)}; of the {len(O)} overture matches, "
      f"google supplies a rating for {len(rat & O)}")
print(f"\ndetails calls a corroborate-first pipeline would make: {len(gm)} of {len(gin)} returned "
      f"(measured run paid {sum(1 for r in grecs.values() if r.get('place'))})")
json.dump({"google": sorted(G), "fsq": sorted(F), "overture": sorted(O)}, open(f"{S}/three_way.json", "w"))
