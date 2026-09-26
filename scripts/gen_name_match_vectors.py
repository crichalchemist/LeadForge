"""Generate api/test/fixtures/name-match-vectors.json — pins name-match.ts to this reference.

Run:  uv run python scripts/gen_name_match_vectors.py <dir-with-google_results.jsonl>
      (or with no argument to emit only the hand-written adversarial cases)

api/src/lib/name-match.ts is a port of the scorer that produced ADR 030's numbers. A drifted port
would quietly change which businesses get enriched and which get charged for a Details call, and
neither shows up as a test failure anywhere else -- the same reason scoring-parity.test.ts replays
Python-scored vectors. Vectors are real measured pairs plus the adversarial cases that earlier
versions of this scorer got wrong.
"""
import json, math, re, sys

A = json.load(open("api/src/data/name-idf.json"))
stop, IDF, DEF = set(A["stop"]), A["idf"], A["default_idf"]

def toks(s):
    out = []
    for t in re.findall(r"[a-z0-9]+", (s or "").lower()):
        if len(t) < 3 or t in stop: continue
        out.append(t[:-1] if len(t) > 4 and t.endswith('s') else t)
    return out
def w(t): return IDF.get(t, DEF)
def bg(s): return {s[i:i+2] for i in range(len(s)-1)}
def cs(a, b):
    ga, gb = bg(a), bg(b)
    if not ga and not gb: return 0.0
    shared = len(ga & gb)
    return shared / (len(ga) + len(gb) - shared)
def tm(a, b):
    if len(a) >= 5 and len(b) >= 5 and (a.startswith(b) or b.startswith(a)): return True
    return cs(a, b) >= 0.8
def score(lic, cand):
    tl, tc = toks(lic), toks(cand)
    if not tl or not tc: return 0.0
    uniq, cands = list(dict.fromkeys(tl)), list(dict.fromkeys(tc))
    den = sum(w(t) for t in uniq)
    if den <= 0: return 0.0
    head = uniq[0]
    for t in uniq:                      # lexicographic tie-break, matching the port
        d = w(t) - w(head)
        if d > 0 or (d == 0 and t < head): head = t
    if not any(tm(head, u) for u in cands): return 0.0
    return sum(w(t) for t in uniq if any(tm(t, u) for u in cands)) / den

# Cases every earlier version of this scorer got wrong, kept so a regression is loud.
CASES = [
    # False positives the head-token gate exists to kill. Both scored ~0.61 before it.
    ("CONSTANCE AFRICAN HAIR BRAIDING", "Marseillais African Hair Braiding"),
    ("CHICAGO NINE SOCIAL CLUB", "Rulers Original Social Club"),
    # True matches the prefix rule rescues (bigram overlap alone scores these at 0.50).
    ("BRAZZAVILLE HAIR BRAIDING", "Brazza Hair Braiding"),
    # Plural/possessive fold.
    ("SANGENE'S STYLING SALON", "Sangenes Styling Salon"),
    # Known FALSE NEGATIVES, recorded deliberately: these are the same business and the scorer
    # rejects them. Documented in ADR 030 rather than tuned away, because loosening the gate
    # re-admits the false positives above.
    ("ZAHARA CICI HAIR BRAIDING", "Zahra cici hair braiding"),
    ("M.V.P. HAIR CUTS AND LINING", "MVP Haircuts & Lining"),
    # Degenerate inputs.
    ("", "Something"),
    ("A&B", "A & B"),
    ("LLC INC THE", "LLC INC THE"),
]
if len(sys.argv) > 1:
    S = sys.argv[1]
    g = [json.loads(l) for l in open(f"{S}/google_results.jsonl") if l.strip()]
    for r in g:
        p = r.get("place")
        if p and p.get("dist") is not None and p["dist"] <= 200:
            CASES.append((r["name"], p["n"]))

vectors = [{"licence": a, "candidate": b, "score": round(score(a, b), 10)} for a, b in CASES]
path = "api/test/fixtures/name-match-vectors.json"
json.dump(vectors, open(path, "w"), indent=2)
above = sum(1 for v in vectors if v["score"] >= 0.5)
print(f"{path}: {len(vectors)} vectors, {above} at or above 0.50")
