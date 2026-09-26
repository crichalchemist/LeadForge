"""Generate api/test/fixtures/name-match-vectors.json — pins name-match.ts to this reference.

Run:  uv run python scripts/gen_name_match_vectors.py <dir-with-google_results.jsonl>
      (or with no argument to emit only the hand-written adversarial cases)

api/src/lib/name-match.ts is a port of the scorer that produced ADR 030's numbers. A drifted port
would quietly change which businesses get enriched and which get charged for a Details call, and
neither shows up as a test failure anywhere else -- the same reason scoring-parity.test.ts replays
Python-scored vectors. Vectors are real measured pairs plus the adversarial cases that earlier
versions of this scorer got wrong.
"""
import json, sys

sys.path.insert(0, "scripts")
from lib.name_match import load_idf, make_scorer   # noqa: E402

stop, IDF, DEF = load_idf()
score = make_scorer(stop, IDF, DEF)

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
