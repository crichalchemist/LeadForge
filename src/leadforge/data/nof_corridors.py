"""
NOF Corridor Data Pipeline

Fetches corridor GeoJSON from Chicago Data Portal (Socrata API) and provides
spatial eligibility queries for the NOF grant program.
"""
import json
from datetime import datetime, timezone
import httpx
import structlog
from sqlalchemy import delete, func, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from leadforge.db.models.nof_corridor import NOFCorridor, CorridorType

logger = structlog.get_logger(__name__)


def fetch_corridor_geojson(app_token: str = "") -> dict:
    """
    Fetch NOF corridor GeoJSON from Chicago Data Portal Socrata API.

    Args:
        app_token: Optional Socrata app token for higher rate limits

    Returns:
        GeoJSON FeatureCollection dict

    Raises:
        httpx.HTTPError: On HTTP errors
    """
    url = "https://data.cityofchicago.org/resource/bfbm-fall.geojson"
    headers = {}
    if app_token:
        headers["$$app_token"] = app_token

    logger.info("fetching_corridor_geojson", url=url)

    with httpx.Client() as client:
        response = client.get(url, headers=headers, timeout=30.0)
        response.raise_for_status()
        geojson = response.json()

    logger.info(
        "fetched_corridor_geojson",
        feature_count=len(geojson.get("features", []))
    )

    return geojson


async def upsert_corridors(session: AsyncSession, features: list[dict]) -> int:
    """
    Upsert NOF corridors from GeoJSON features into the database.

    Performs a full refresh: deletes all existing corridors and bulk inserts new ones.

    Args:
        session: Async SQLAlchemy session
        features: List of GeoJSON features from FeatureCollection

    Returns:
        Count of corridors inserted
    """
    logger.info("upserting_corridors", feature_count=len(features))

    # Delete all existing corridors (full refresh)
    await session.execute(delete(NOFCorridor))

    # Process each feature
    corridors = []
    for feature in features:
        properties = feature.get("properties", {})
        geometry = feature.get("geometry")

        # Extract corridor name - try both "street" and "corridor_name"
        corridor_name = properties.get("street") or properties.get("corridor_name")
        if not corridor_name:
            logger.warning("skipping_feature_no_name", properties=properties)
            continue

        # Determine corridor type - check if "priority" appears in any property value
        corridor_type = CorridorType.ELIGIBLE
        for value in properties.values():
            if isinstance(value, str) and "priority" in value.lower():
                corridor_type = CorridorType.PRIORITY
                break

        # Convert geometry to PostGIS format using ST_GeomFromGeoJSON
        if not geometry:
            logger.warning("skipping_feature_no_geometry", corridor_name=corridor_name)
            continue

        corridor = NOFCorridor(
            corridor_name=corridor_name,
            corridor_type=corridor_type,
            geometry=func.ST_GeomFromGeoJSON(json.dumps(geometry)),
            source_updated_at=None,  # Could parse from properties if available
            fetched_at=datetime.now(timezone.utc)
        )
        corridors.append(corridor)

    # Bulk insert
    session.add_all(corridors)
    await session.flush()

    count = len(corridors)
    logger.info("upserted_corridors", count=count)

    return count


async def check_corridor_eligibility(
    session: AsyncSession,
    latitude: float,
    longitude: float
) -> dict | None:
    """
    Check if a point is eligible for NOF grant (within 50m of any corridor).

    Args:
        session: Async SQLAlchemy session
        latitude: Latitude of point to check
        longitude: Longitude of point to check

    Returns:
        Dict with corridor_name, corridor_type, is_priority if found, else None
    """
    # Create point geometry from lat/lon
    # ST_DWithin requires geography type for meter-based distance
    point_geog = func.ST_GeogFromText(f"POINT({longitude} {latitude})")

    # Query for corridors within 50 meters, prioritizing PRIORITY type
    stmt = (
        select(NOFCorridor)
        .where(
            func.ST_DWithin(
                func.ST_GeogFromText(func.ST_AsText(NOFCorridor.geometry)),
                point_geog,
                50  # 50 meters
            )
        )
        .order_by(
            # PRIORITY corridors first (PostgreSQL enum ordering)
            NOFCorridor.corridor_type.desc()
        )
        .limit(1)
    )

    result = await session.execute(stmt)
    corridor = result.scalar_one_or_none()

    if corridor:
        logger.info(
            "corridor_eligibility_found",
            corridor_name=corridor.corridor_name,
            corridor_type=corridor.corridor_type.value,
            latitude=latitude,
            longitude=longitude
        )
        return {
            "corridor_name": corridor.corridor_name,
            "corridor_type": corridor.corridor_type.value,
            "is_priority": corridor.corridor_type == CorridorType.PRIORITY
        }

    logger.info(
        "corridor_eligibility_not_found",
        latitude=latitude,
        longitude=longitude
    )
    return None
