import asyncio

import structlog

from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger()


@celery_app.task(bind=True, max_retries=2, default_retry_delay=120)
def outreach_batch_task(
    self, zip_code: str, niche: str, batch_size: int = 10, min_score: float = 30.0
):
    """Celery task to run outreach pipeline for a zip+niche batch."""

    async def _run():
        from leadforge.db.models.business import NicheType
        from leadforge.db.session import async_session
        from leadforge.pipeline.outreach_pipeline import run_outreach_pipeline

        niche_enum = NicheType(niche)
        async with async_session() as session:
            records = await run_outreach_pipeline(
                session,
                zip_code,
                niche_enum,
                batch_size=batch_size,
                min_score=min_score,
            )
            logger.info(
                "outreach_batch_complete",
                zip_code=zip_code,
                niche=niche,
                count=len(records),
            )

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error(
            "outreach_batch_failed", zip_code=zip_code, niche=niche, error=str(exc)
        )
        raise self.retry(exc=exc)


@celery_app.task(bind=True, max_retries=1, default_retry_delay=30)
def initiate_single_call_task(self, outreach_id: str):
    """Celery task to initiate a single outreach call."""

    async def _run():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from leadforge.db.models.business import Business
        from leadforge.db.models.outreach_record import OutreachRecord
        from leadforge.db.session import async_session
        from leadforge.voice.call_manager import initiate_call
        from leadforge.voice.retell_client import RetellClient

        async with async_session() as session:
            result = await session.execute(
                select(OutreachRecord).where(OutreachRecord.id == outreach_id)
            )
            outreach = result.scalar_one_or_none()
            if not outreach:
                logger.warning("outreach_not_found", outreach_id=outreach_id)
                return

            result = await session.execute(
                select(Business)
                .options(selectinload(Business.digital_presence))
                .where(Business.id == outreach.business_id)
            )
            business = result.scalar_one_or_none()
            if not business:
                return

            async with RetellClient() as retell:
                agent = await retell.create_agent(
                    name=f"leadforge-{business.niche.value}",
                    prompt="You are a professional marketing consultant reaching out to local businesses.",
                )
                agent_id = agent.get("agent_id") if agent else None
                if agent_id:
                    await initiate_call(session, outreach, business, retell, agent_id)
                    await session.commit()

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("single_call_failed", outreach_id=outreach_id, error=str(exc))
        raise self.retry(exc=exc)
