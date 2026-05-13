#!/usr/bin/env python3
"""One-time script: pre-compute corridor membership for all businesses.

Run against the existing PostGIS database before decommissioning it.
Outputs a JSON file suitable for bulk-importing corridor status into D1.

Usage:
    python scripts/precompute_corridors.py --db-url postgresql://... --output corridor_data.json
"""
import argparse
import json
import sys
from datetime import datetime

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 is required. Install with: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


def precompute_corridors(db_url: str, output_path: str):
    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Query businesses with their corridor intersection
    cur.execute("""
        SELECT
            b.id,
            b.name,
            CASE WHEN nc.id IS NOT NULL THEN 1 ELSE 0 END AS in_nof_corridor,
            nc.name AS nof_corridor_name
        FROM businesses b
        LEFT JOIN nof_corridors nc
            ON ST_Contains(nc.geometry, b.location::geometry)
            OR ST_Intersects(nc.geometry, b.location::geometry)
    """)

    rows = cur.fetchall()
    cur.close()
    conn.close()

    # Build corridor lookup: which businesses are in which corridors
    businesses = {}
    for row in rows:
        biz_id = row['id']
        if biz_id not in businesses:
            businesses[biz_id] = {
                'id': biz_id,
                'in_nof_corridor': 0,
                'nof_corridor_name': None,
                'zone_names': [],
            }
        if row['in_nof_corridor']:
            businesses[biz_id]['in_nof_corridor'] = 1
            businesses[biz_id]['zone_names'].append(row['nof_corridor_name'])

    # Flatten to update format: primary corridor is first match
    updates = []
    for biz_id, data in businesses.items():
        updates.append({
            'id': biz_id,
            'in_nof_corridor': data['in_nof_corridor'],
            'nof_corridor_name': data['zone_names'][0] if data['zone_names'] else None,
        })

    with open(output_path, 'w') as f:
        json.dump({
            'generated_at': datetime.utcnow().isoformat(),
            'total_businesses': len(updates),
            'in_corridor_count': sum(1 for u in updates if u['in_nof_corridor']),
            'updates': updates,
        }, f, indent=2)

    print(f"Pre-computed corridor data for {len(updates)} businesses")
    print(f"  In corridor: {sum(1 for u in updates if u['in_nof_corridor'])}")
    print(f"  Not in corridor: {sum(1 for u in updates if not u['in_nof_corridor'])}")
    print(f"  Output: {output_path}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Pre-compute NOF corridor membership for all businesses')
    parser.add_argument('--db-url', required=True, help='PostgreSQL connection URL with PostGIS')
    parser.add_argument('--output', default='corridor_updates.json', help='Output JSON file path')
    args = parser.parse_args()
    precompute_corridors(args.db_url, args.output)
