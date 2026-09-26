"""Generate api/src/data/name-idf.json — the IDF weights the Worker's name scorer needs.

Run:  uv run --with duckdb python scripts/gen_name_idf.py

The Worker corroborates a Google Find Place name against the licence name before paying for a
Details call (ADR 030), and that scorer is IDF-weighted: sector words ("hair", "salon", "barber")
must carry almost no weight so the distinctive token decides the match. IDF needs corpus-wide
document frequencies, which cannot be computed in a Worker, so they are precomputed here from every
named Overture place in Chicago and bundled as an asset -- the same pattern ADR 028 uses for the
corridor polygons, and like that asset this is a snapshot: refreshing means re-running this and
deploying.

Only tokens with df > 1 are stored. A token absent from the table has df <= 1, so it is maximally
rare, and the reader assigns it log(N) -- exact for a token seen once, and the right value in spirit
for one never seen. That single principled default is what keeps the file to ~390 KiB instead of the
~1.5 MiB a full 99k-token vocabulary would need.
"""
import json
import math
import re
from collections import Counter

import duckdb

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
P = "s3://overturemaps-us-west-2/release/2026-08-19.0/theme=places/type=place/*"
CHICAGO = "bbox.ymin BETWEEN 41.60 AND 42.05 AND bbox.xmin BETWEEN -87.95 AND -87.50"

rows = con.execute(f"""SELECT names.primary FROM read_parquet('{P}', filename=false, hive_partitioning=1)
  WHERE {CHICAGO} AND names.primary IS NOT NULL""").fetchall()

STOP = ['llc','inc','corp','corporation','ltd','the','and','dba','co','company',
        'incorporated','of','by','at']
stop = set(STOP)
def toks(s):
    out = []
    for t in re.findall(r"[a-z0-9]+", (s or "").lower()):
        if len(t) < 3 or t in stop: continue
        out.append(t[:-1] if len(t) > 4 and t.endswith('s') else t)
    return out

df, n = Counter(), 0
for (nm,) in rows:
    d = toks(nm)
    if d:
        n += 1
        df.update(set(d))

idf = {t: round(math.log(n / c), 4) for t, c in df.items() if c > 1}
out = {"docs": n, "default_idf": round(math.log(n), 4), "stop": STOP, "idf": idf}
path = "api/src/data/name-idf.json"
with open(path, "w") as f:
    json.dump(out, f, separators=(",", ":"), sort_keys=True)
print(f"{path}: docs={n} stored_tokens={len(idf)} vocab={len(df)} default_idf={out['default_idf']}")
