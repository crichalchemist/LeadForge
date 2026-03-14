import structlog

from leadforge.config import settings
from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger(__name__)


@celery_app.task(name="leadforge.tasks.corridor_refresh_tasks.refresh_nof_corridors")
def refresh_nof_corridors():
    """Refresh NOF corridor data from Chicago Data Portal."""
    import asyncio

    from leadforge.data.nof_corridors import fetch_corridor_geojson, upsert_corridors
    from leadforge.db.session import async_session

    geojson = fetch_corridor_geojson(app_token=settings.SOCRATA_APP_TOKEN)
    features = geojson.get("features", [])

    async def _upsert():
        async with async_session() as session:
            count = await upsert_corridors(session, features)
            await session.commit()
            return count

    count = asyncio.run(_upsert())
    logger.info("corridor_refresh_complete", count=count)
    return count
