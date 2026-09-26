"""Build the overture_matches table contents for every licensed Chicago business.

Run:  uv run --with duckdb python scripts/build_overture_matches.py <outdir>
Then: see the load command this prints at the end.

Overture cannot be queried from a Worker (DuckDB) and cannot be mirrored into D1 (214,735 Chicago
places against a 100,000 row/day free-tier write budget), so the matching happens here and only the
result is stored -- about 23.6k rows, one per licence account/site pair across roughly 20.8k distinct
accounts, which is about a quarter of one day's budget (a refresh costs double, because the wholesale
DELETE counts as rows written too). Keep this figure in step with the header of
api/migrations/0004_overture_matches.sql; they are the same claim in two files. See
docs/superpowers/specs/2026-09-25-overture-composition-design.md.

Emits chunked SQL rather than one file because D1 has a documented Maximum SQL statement length of
100,000 bytes. At 500 rows/chunk the largest chunk measured 66,720 bytes -- 67% of that limit, a
1.5x margin that is data-dependent: a longer POI name, website or phone in a future Overture
release could cross it. 250 rows/chunk keeps the largest chunk around 33 KB, a 3x margin.
"""

import json
import math
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

import duckdb

sys.path.insert(0, "scripts")
from lib.name_match import THRESHOLD, load_idf, make_scorer  # noqa: E402

OUTDIR = sys.argv[1]
CHUNK = 250
RADIUS_M = 200
RELEASE = "2026-08-19.0"
PARQUET = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
# Chicago. The Parquet carries bbox row-group statistics, so this prunes the scan rather than
# filtering after the fact.
BBOX = "bbox.ymin BETWEEN 41.60 AND 42.05 AND bbox.xmin BETWEEN -87.95 AND -87.50"

# The 15 niches' Socrata search terms, copied from NICHE_MAPPING in api/src/scrapers/socrata.ts.
TERMS = [
    "hair service",
    "nail service",
    "hair, nail, and skin care",
    "sale and storage of tires",
    "tavern",
    "tobacco",
    "butcher",
    "tow truck",
    "tow storage",
    "landscap",
    "motor vehicle repair",
    "junk peddler",
    "plumb",
    "veterinar",
    "security service",
]


def fetch_licences():
    """Every licence row across the 15 niches, collapsed exactly as dedupeLicenseRows does:
    key on account_number/site_number, newest license_start_date wins."""
    where = "(" + " OR ".join(f"upper(business_activity) like upper('%{t}%')" for t in TERMS) + ")"
    latest = {}
    offset = 0
    while True:
        params = urllib.parse.urlencode({"$where": where, "$order": ":id", "$limit": 1000, "$offset": offset})
        with urllib.request.urlopen(f"https://data.cityofchicago.org/resource/r5kz-chrr.json?{params}") as response:
            page = json.load(response)
        for raw in page:
            account = raw.get("account_number")
            if not account:
                continue  # no identity to key on; dedupeLicenseRows falls back to name+zip, which
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
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def sql_str(value):
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


def blank_to_null(value):
    """Normalise an empty or whitespace-only string to None at the point of writing, so the two
    downstream readers -- SQLite TRIM(), which strips only U+0020, and JavaScript .trim(), which
    strips more -- never have to agree on what counts as blank. NULL means the same thing to both."""
    if value is not None and str(value).strip() == "":
        return None
    return value


def main():
    licences = fetch_licences()
    print(f"licence accounts: {len(licences)}")
    geocoded = [b for b in licences if b["lat"] is not None and b["lon"] is not None]
    print(f"geocoded: {len(geocoded)}")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';")
    places = con.execute(f"""
      SELECT id, names.primary AS nm, ST_Y(geometry) AS lat, ST_X(geometry) AS lon,
             coalesce(websites, [])[1] AS website,
             coalesce(socials, []) AS socials,
             coalesce(phones, [])[1] AS phone
      FROM read_parquet('{PARQUET}', filename=false, hive_partitioning=1)
      WHERE {BBOX} AND names.primary IS NOT NULL
    """).fetchall()
    print(f"overture places in bbox: {len(places)}")
    print(f"overture release: {RELEASE}")

    stop, idf, default_idf = load_idf()
    score = make_scorer(stop, idf, default_idf)

    # Bucket places onto a coarse grid so each licence compares against its neighbourhood rather
    # than all 214k rows. 0.003 degrees is comfortably larger than the 200 m radius at this latitude.
    grid = {}
    for place in places:
        grid.setdefault((round(place[2] / 0.003), round(place[3] / 0.003)), []).append(place)

    rows = []
    for biz in licences:
        if biz["lat"] is None:
            # Ungeocoded: the build could not look at this licence at all, which is not the same
            # as looking and finding nothing. Emit no row -- "no row" already means "not yet
            # covered", and it self-repairs once the city geocodes the address, because rebuilds
            # are wholesale (I4).
            continue
        best = None
        gy, gx = round(biz["lat"] / 0.003), round(biz["lon"] / 0.003)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for place in grid.get((gy + dy, gx + dx), ()):
                    distance = haversine(biz["lat"], biz["lon"], place[2], place[3])
                    if distance > RADIUS_M:
                        continue
                    value = score(biz["name"], place[1])
                    if value >= THRESHOLD and (
                        best is None or value > best[0] or (value == best[0] and distance < best[2])
                    ):
                        best = (value, place, distance)
        if best:
            value, place, distance = best
            socials = place[5] or []
            rows.append(
                (
                    biz,
                    1,
                    place[0],
                    place[1],
                    round(value, 4),
                    round(distance),
                    blank_to_null(place[4]),
                    int(any("facebook" in (s or "") for s in socials)),
                    int(any("instagram" in (s or "") for s in socials)),
                    blank_to_null(place[6]),
                )
            )
        else:
            rows.append((biz, 0, None, None, None, None, None, 0, 0, None))

    matched = sum(1 for r in rows if r[1] == 1)
    print(f"matched: {matched} / {len(rows)} ({100 * matched / max(len(rows), 1):.0f}%)")

    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    chunks = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start : start + CHUNK]
        values = ",\n  ".join(
            "("
            + ", ".join(
                [
                    sql_str(biz["account_number"]),
                    sql_str(biz["site_number"]),
                    str(matched_flag),
                    sql_str(gers),
                    sql_str(name),
                    "NULL" if value is None else str(value),
                    "NULL" if distance is None else str(distance),
                    sql_str(website),
                    str(facebook),
                    str(instagram),
                    sql_str(phone),
                    sql_str(built_at),
                ]
            )
            + ")"
            for (biz, matched_flag, gers, name, value, distance, website, facebook, instagram, phone) in chunk
        )
        path = f"{OUTDIR}/overture_matches.{chunks:03d}.sql"
        with open(path, "w") as handle:
            if chunks == 0:
                # Wholesale replacement: no row outlives a rebuild, which is what keeps GERS id
                # stability across monthly releases from mattering. The release is recorded here
                # as a comment (not a column -- rebuilds are wholesale, RELEASE is a pinned
                # constant in this script, and git history plus a real built_at already recover
                # it) so a reader of a chunk file knows which Overture release produced it (I2).
                handle.write(f"-- Overture release: {RELEASE}\n")
                handle.write("DELETE FROM overture_matches;\n")
            handle.write(
                "INSERT INTO overture_matches (account_number, site_number, matched, gers_id,"
                " matched_name, score, distance_m, website, has_facebook, has_instagram, phone,"
                f" built_at) VALUES\n  {values};\n"
            )
        chunks += 1

    print(f"wrote {chunks} chunk files to {OUTDIR}")
    print("load with:")
    print(
        f"  for f in {OUTDIR}/overture_matches.*.sql; do "
        '(cd api && npx wrangler d1 execute leadforge-db --remote --file="$f") || break; done'
    )


if __name__ == "__main__":
    main()
