import asyncio

import structlog

from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger()


@celery_app.task(bind=True, max_retries=2, default_retry_delay=60)
def process_sentiment_task(self, outreach_id: str):
    """Celery task to analyze sentiment and apply feedback to scoring."""

    async def _run():
        from sqlalchemy import select

        from leadforge.db.models.outreach_record import OutreachRecord
        from leadforge.db.session import async_session
        from leadforge.llm.sentiment import analyze_sentiment
        from leadforge.pipeline.sentiment_feedback import apply_sentiment_feedback

        async with async_session() as session:
            result = await session.execute(
                select(OutreachRecord).where(OutreachRecord.id == outreach_id)
            )
            outreach = result.scalar_one_or_none()
            if not outreach:
                logger.warning("outreach_not_found", outreach_id=outreach_id)
                return

            # Analyze sentiment from transcript
            if outreach.call_transcript:
                sentiment_result = await analyze_sentiment(outreach.call_transcript)
                outreach.call_sentiment_score = sentiment_result.get(
                    "sentiment_score", 0.0
                )

            # Apply feedback to lead score
            multiplier = await apply_sentiment_feedback(session, outreach)
            await session.commit()

            logger.info(
                "sentiment_processed",
                outreach_id=outreach_id,
                sentiment=outreach.call_sentiment_score,
                multiplier=multiplier,
            )

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.error("sentiment_task_failed", outreach_id=outreach_id, error=str(exc))
        raise self.retry(exc=exc)
