import asyncio
import structlog
from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger()


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def enrich_business_task(self, business_id: str):
    """Celery task to enrich a single business."""
    async def _run():
        from sqlalchemy import select
        from leadforge.db.session import async_session
        from leadforge.db.models.business import Business
        from leadforge.pipeline.enrichment import enrich_business

        async with async_session() as session:
            result = await session.execute(
                select(Business).where(Business.id == business_id)
            )
            business = result.scalar_one_or_none()
            if not business:
                logger.warning("business_not_found", business_id=business_id)
                return

            await enrich_business(session, business)
            await session.commit()

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("enrich_task_failed", business_id=business_id, error=str(exc))
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def compute_all_contexts_task(self, zip_code: str, niche: str):
    """Celery task to compute competitive context for a zip+niche."""
    async def _run():
        from leadforge.db.session import async_session
        from leadforge.db.models.business import NicheType
        from leadforge.scoring.competitive_context import compute_competitive_context

        niche_enum = NicheType(niche)
        async with async_session() as session:
            await compute_competitive_context(session, zip_code, niche_enum)
            await session.commit()

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("context_task_failed", zip_code=zip_code, niche=niche, error=str(exc))
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def full_scoring_task(self, zip_code: str, niche: str):
    """Celery task to run full scoring pipeline for a zip+niche."""
    async def _run():
        from leadforge.db.session import async_session
        from leadforge.db.models.business import NicheType
        from leadforge.pipeline.scoring_pipeline import run_scoring_pipeline

        niche_enum = NicheType(niche)
        async with async_session() as session:
            count = await run_scoring_pipeline(session, zip_code, niche_enum)
            logger.info("scoring_task_complete", zip_code=zip_code, niche=niche, scored=count)

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("scoring_task_failed", zip_code=zip_code, niche=niche, error=str(exc))
        raise self.retry(exc=exc)
