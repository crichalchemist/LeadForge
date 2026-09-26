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
