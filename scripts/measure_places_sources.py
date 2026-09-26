"""Three-way head-to-head: Google Places (legacy), Foursquare API, Overture Maps.

One name scorer, one candidate corpus, one 200 m radius, the same 157 licensed 'hair service'
businesses in 60619. Answers the question ADR 029 could not while Google billing was broken:
now that it works again, which source -- or which combination -- should enrich discovery?

Run:  node scripts/fetch_places_candidates.mjs licences   <dir>
      node scripts/fetch_places_candidates.mjs google     <dir>
      node scripts/fetch_places_candidates.mjs foursquare <dir>
      uv run --with duckdb python scripts/measure_places_sources.py <dir>

The scorer is RECONSTRUCTED from measure_overture_match.py's design -- IDF-weighted fuzzy token
containment with a head-token gate -- and is NOT verified equivalent to it. It re-measures Overture
at 71 where that script reported 74, and the candidate set cannot explain the gap: every 200 m
neighbourhood lies inside even the tightest bbox tried, so only the IDF weights move, and they move
Overture 72 -> 71 as the corpus grows 5,645 -> 9,352 POIs. 8,470 sits between those, so the two
scorers differ in something else -- the threshold, the tokenizer, or the best-candidate rule.
Consequence: the three-way comparison below is internally valid, because all three sources go
through this one function, but the earlier run's figures (Overture 74, Foursquare 57/83) are NOT
comparable to these. Do not retune the threshold to close the gap; reconcile the two scorers.

The head-token gate exists because IDF alone only discounts sector words, and three of them
("african", "hair", "braiding") still outvote one distinctive name. Overture needs no credentials;
the bucket is anonymously readable.

Caveat that survived into the numbers: Overture's "returned" column is 157 because every business
has some POI within 200 m, and matching is exhaustive and offline, so it has no "false match"
count comparable to the two APIs' single nearest result.
"""
import duckdb, json, math, re, sys
from collections import Counter

S = sys.argv[1]
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
P = "s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*"
TH, M, RADIUS = 0.50, 0.03, 200

biz = json.load(open(f"{S}/licences.json"))
la = [b["latitude"] for b in biz]; lo = [b["longitude"] for b in biz]
rows = con.execute(f"""
  SELECT names.primary AS nm, ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
         len(coalesce(websites,[])) AS nweb, len(coalesce(socials,[])) AS nsoc,
         len(coalesce(phones,[])) AS nph
  FROM read_parquet('{P}', filename=false, hive_partitioning=1)
  WHERE bbox.ymin BETWEEN {min(la)-M} AND {max(la)+M}
    AND bbox.xmin BETWEEN {min(lo)-M} AND {max(lo)+M} AND names.primary IS NOT NULL""").fetchall()

STOP = {'llc','inc','corp','corporation','ltd','the','and','dba','co','company','incorporated','of','by','at'}
def toks(s):
    out=[]
    for t in re.findall(r"[a-z0-9]+",(s or "").lower()):
        if len(t)<3 or t in STOP: continue
        if len(t)>4 and t.endswith('s'): t=t[:-1]
        out.append(t)
    return out
docs=[toks(r[0]) for r in rows]+[toks(b["name"]) for b in biz]
df=Counter()
for d in docs: df.update(set(d))
N=len(docs); idf={t:math.log(N/c) for t,c in df.items()}
def bg(s): return {s[i:i+2] for i in range(len(s)-1)}
def charsim(a,b):
    A,B=bg(a),bg(b)
    if not A or not B: return 1.0 if a==b else 0.0
    return len(A&B)/len(A|B)
def tokmatch(t,u):
    if len(t)>=5 and len(u)>=5 and (t.startswith(u) or u.startswith(t)): return True
    return charsim(t,u)>=0.80
def score(a,b):
    ta,tb=toks(a),toks(b)
    if not ta or not tb: return 0.0
    sa=set(ta); tbs=set(tb)
    den=sum(idf.get(t,0) for t in sa)
    if den<=0: return 0.0
    head=max(sa,key=lambda t: idf.get(t,0))
    if not any(tokmatch(head,u) for u in tbs): return 0.0
    return sum(idf.get(t,0) for t in sa if any(tokmatch(t,u) for u in tbs))/den
def hav(a,b,c,d):
    R,t=6371000.0,math.pi/180; x,y=(c-a)*t,(d-b)*t
    h=math.sin(x/2)**2+math.cos(a*t)*math.cos(c*t)*math.sin(y/2)**2
    return 2*R*math.asin(math.sqrt(h))

# ---- Overture ----
ov={}
for b in biz:
    best=None
    for r in rows:
        if abs(r[1]-b["latitude"])>0.0025 or abs(r[2]-b["longitude"])>0.0033: continue
        if hav(b["latitude"],b["longitude"],r[1],r[2])>RADIUS: continue
        s=score(b["name"],r[0])
        if s>=TH and (best is None or s>best[0]): best=(s,r)
    if best: ov[b["name"]]=best
ov_ret=sum(1 for b in biz if any(
    hav(b["latitude"],b["longitude"],r[1],r[2])<=RADIUS
    for r in rows if abs(r[1]-b["latitude"])<=0.0025 and abs(r[2]-b["longitude"])<=0.0033))

# ---- Google ----
g=[json.loads(l) for l in open(f"{S}/google_results.jsonl") if l.strip()]
g=[r for r in g if r.get("place") and (r["place"].get("dist") or 1e9)<=RADIUS]
gm={r["name"]:(score(r["name"],r["place"]["n"]),r["place"]) for r in g}
gm={k:v for k,v in gm.items() if v[0]>=TH}

# ---- Foursquare ----
f=[json.loads(l) for l in open(f"{S}/fsq_results.jsonl") if l.strip()]
f=[r for r in f if r.get("place")]
fm={r["name"]:(score(r["name"],r["place"]["n"]),r["place"]) for r in f}
fm={k:v for k,v in fm.items() if v[0]>=TH}

def pct(n): return f"{100*n/157:.0f}%"
print(f"corpus: {len(rows)} overture POIs, {N} idf docs, threshold {TH}, radius {RADIUS}m, 157 businesses\n")
print(f"{'source':<12}{'returned':>9}{'corrob':>8}{'false':>7}{'website':>9}{'phone':>7}{'social':>8}{'rating':>8}{'rev>=5':>8}")
print(f"{'Google':<12}{len(g):>9}{len(gm):>8}{len(g)-len(gm):>7}"
      f"{sum(1 for s,p in gm.values() if p.get('site')):>9}"
      f"{sum(1 for s,p in gm.values() if p.get('phone')):>7}"
      f"{'-':>8}"
      f"{sum(1 for s,p in gm.values() if p.get('rating') is not None):>8}"
      f"{sum(1 for s,p in gm.values() if (p.get('reviews') or 0)>=5):>8}")
print(f"{'Foursquare':<12}{len(f):>9}{len(fm):>8}{len(f)-len(fm):>7}"
      f"{sum(1 for s,p in fm.values() if p.get('site')):>9}"
      f"{sum(1 for s,p in fm.values() if p.get('tel')):>7}"
      f"{sum(1 for s,p in fm.values() if p.get('fb') or p.get('ig') or p.get('tw')):>8}"
      f"{0:>8}{0:>8}")
print(f"{'Overture':<12}{ov_ret:>9}{len(ov):>8}{'-':>7}"
      f"{sum(1 for s,r in ov.values() if r[3]>0):>9}"
      f"{sum(1 for s,r in ov.values() if r[5]>0):>7}"
      f"{sum(1 for s,r in ov.values() if r[4]>0):>8}{0:>8}{0:>8}")
G,F,O=set(gm),set(fm),set(ov)
print(f"\ncoverage  google={len(G)} ({pct(len(G))})  foursquare={len(F)} ({pct(len(F))})  overture={len(O)} ({pct(len(O))})")
print(f"unions    G|O={len(G|O)} ({pct(len(G|O))})   G|F={len(G|F)}   F|O={len(F|O)}   all three={len(G|F|O)} ({pct(len(G|F|O))})")
print(f"overture misses covered by google: {len(G-O)}   google misses covered by overture: {len(O-G)}")
print(f"foursquare adds over G|O: {len(F-(G|O))}")
wg={k for k,(s,p) in gm.items() if p.get('site')}
wo={k for k,(s,r) in ov.items() if r[3]>0}
print(f"website union G|O={len(wg|wo)} (google {len(wg)}, overture {len(wo)}, overture-only {len(wo-wg)})")
rat={k for k,(s,p) in gm.items() if p.get('rating') is not None}
print(f"rating available on {len(rat)}/157; of the {len(O)} overture matches, google supplies a rating for {len(rat&O)}")
json.dump({"google":sorted(G),"fsq":sorted(F),"overture":sorted(O)},open(f"{S}/three_way.json","w"))
