"""Regenerate the NOF corridor asset the Worker bundles.

The City publishes the corridors as two ArcGIS polygon layers, linked from the
official NOF site's eligibility lookup app. They carry no name attribute, so a
corridor is identified by its layer and FID.

Coordinates are rounded to five decimals (~1.1 m at Chicago's latitude), which
is far finer than a corridor boundary is meaningful to, and roughly halves the
asset. Only the outer ring of each polygon is kept: a hole could only shrink a
corridor, and the published bands have none.

Usage:
    uv run python scripts/fetch_nof_corridors.py
"""

import json
from datetime import datetime, timezone

import httpx

BASE = "https://services7.arcgis.com/A03QrhyHnDaUmK0W/arcgis/rest/services"
LAYERS = {
    "eligible": f"{BASE}/NOF_EligibleCorridor_20241112/FeatureServer/10",
    "priority": f"{BASE}/NOF_PriorityCorridor_20241112/FeatureServer/10",
}
OUTPUT = "api/src/data/nof-corridors.json"
PRECISION = 5


def fetch_layer(url: str) -> dict:
    query = f"{url}/query?where=1%3D1&outFields=FID&outSR=4326&f=geojson"
    response = httpx.get(query, timeout=60.0)
    response.raise_for_status()
    return response.json()


def rings_from(feature: dict, is_priority: int) -> list[dict]:
    geometry = feature.get("geometry") or {}
    coords = geometry.get("coordinates") or []
    polygons = coords if geometry.get("type") == "MultiPolygon" else [coords]

    out = []
    for polygon in polygons:
        if not polygon:
            continue
        ring = [
            [round(x, PRECISION), round(y, PRECISION)] for x, y in polygon[0]
        ]
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        out.append(
            {
                "t": is_priority,
                "f": feature.get("properties", {}).get("FID"),
                "b": [min(xs), min(ys), max(xs), max(ys)],
                "r": ring,
            }
        )
    return out


def main() -> None:
    rings: list[dict] = []
    for name, url in LAYERS.items():
        geojson = fetch_layer(url)
        features = geojson.get("features", [])
        before = len(rings)
        for feature in features:
            rings.extend(rings_from(feature, 1 if name == "priority" else 0))
        print(f"{name}: {len(features)} features -> {len(rings) - before} rings")

    asset = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": LAYERS,
        "rings": rings,
    }
    with open(OUTPUT, "w") as fh:
        json.dump(asset, fh, separators=(",", ":"))

    vertices = sum(len(r["r"]) for r in rings)
    print(f"wrote {OUTPUT}: {len(rings)} rings, {vertices} vertices")


if __name__ == "__main__":
    main()
