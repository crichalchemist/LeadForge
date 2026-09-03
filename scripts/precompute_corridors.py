#!/usr/bin/env python3
"""One-time script: pre-compute corridor membership for all businesses.

Run against the existing PostGIS database before decommissioning it.
Outputs a JSON file suitable for bulk-importing corridor status into D1.

The corridor geometry is MULTILINESTRING (street center-lines), so spatial
matching uses ST_DWithin with a 50-metre buffer around each line feature.

Usage:
    python scripts/precompute_corridors.py --db-url postgresql://... --output corridor_data.json
"""
import argparse
import json
import sys
from datetime import datetime, timezone

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 is required. Install with: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def precompute_corridors(db_url: str, output_path: str) -> None:
    """Query each business against NOF corridors using a 50 m buffer.

    Args:
        db_url: PostgreSQL connection string (must include PostGIS extension).
        output_path: Path for the output JSON file. Silently overwrites existing.

    Output JSON schema:
        generated_at: ISO-8601 timestamp.
        total_businesses: Number of businesses processed.
        in_corridor_count: Number matching at least one corridor.
        updates: Array of {id, in_nof_corridor, nof_corridor_name}.
    """
    try:
        conn = psycopg2.connect(db_url)
    except psycopg2.OperationalError as exc:
        print(f"ERROR: Could not connect to database: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        # Corridor geometry is MULTILINESTRING — use ST_DWithin with 50 m buffer
        # Cast to geography for metre-accurate distance calculations.
        cur.execute("""
            SELECT
                b.id::text AS id,
                b.name,
                CASE WHEN nc.id IS NOT NULL THEN 1 ELSE 0 END AS in_nof_corridor,
                nc.corridor_name AS nof_corridor_name
            FROM businesses b
            LEFT JOIN nof_corridors nc
                ON ST_DWithin(nc.geometry::geography, b.location::geography, 50)
        """)

        rows = cur.fetchall()
    finally:
        cur.close()
        conn.close()

    # Aggregate per business (a business may intersect multiple corridors).
    businesses: dict = {}
    for row in rows:
        biz_id: str = row["id"]
        if biz_id not in businesses:
            businesses[biz_id] = {
                "id": biz_id,
                "in_nof_corridor": 0,
                "nof_corridor_name": None,
                "zone_names": [],
            }
        if row["in_nof_corridor"]:
            businesses[biz_id]["in_nof_corridor"] = 1
            if row["nof_corridor_name"] is not None:
                businesses[biz_id]["zone_names"].append(row["nof_corridor_name"])

    # Flatten to update list — primary corridor is first match.
    updates: list[dict] = []
    for biz_id, data in businesses.items():
        updates.append({
            "id": biz_id,
            "in_nof_corridor": data["in_nof_corridor"],
            "nof_corridor_name": data["zone_names"][0] if data["zone_names"] else None,
        })

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_businesses": len(updates),
        "in_corridor_count": sum(1 for u in updates if u["in_nof_corridor"]),
        "updates": updates,
    }

    try:
        with open(output_path, "w") as f:
            json.dump(output, f, indent=2, default=str)
    except OSError as exc:
        print(f"ERROR: Could not write output file: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Pre-computed corridor data for {len(updates)} businesses")
    print(f"  In corridor: {sum(1 for u in updates if u['in_nof_corridor'])}")
    print(f"  Not in corridor: {sum(1 for u in updates if not u['in_nof_corridor'])}")
    print(f"  Output: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Pre-compute NOF corridor membership for all businesses"
    )
    parser.add_argument("--db-url", required=True, help="PostgreSQL connection URL with PostGIS")
    parser.add_argument(
        "--output", default="corridor_updates.json", help="Output JSON file path"
    )
    args = parser.parse_args()
    precompute_corridors(args.db_url, args.output)
