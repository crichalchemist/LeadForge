import asyncio
import uuid

import structlog

from leadforge.config import settings
from leadforge.tasks.celery_app import celery_app

logger = structlog.get_logger()


@celery_app.task(bind=True, max_retries=1, default_retry_delay=300)
def recalibrate_all_businesses(self):
    """Quarterly recalibration: re-enrich, recompute contexts, and rescore all active businesses."""

    async def _run() -> dict:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from leadforge.db.models.business import Business
        from leadforge.db.models.competitive_context import CompetitiveContext
        from leadforge.db.models.lead_score import LeadScore
        from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage
        from leadforge.db.session import async_session
        from leadforge.pipeline.enrichment import enrich_business
        from leadforge.scoring.competitive_context import compute_competitive_context
        from leadforge.scoring.composite import compute_composite_score

        threshold = settings.RECALIBRATION_SCORE_CHANGE_THRESHOLD

        stats = {
            "total": 0,
            "enriched": 0,
            "rescored": 0,
            "errors": 0,
            "significant_changes": 0,
        }

        async with async_session() as session:
            # Subquery: business IDs that are disqualified or lost
            excluded_subq = (
                select(OutreachRecord.business_id)
                .where(
                    OutreachRecord.status.in_(
                        [
                            PipelineStage.LOST,
                            PipelineStage.DISQUALIFIED,
                        ]
                    )
                )
                .distinct()
                .scalar_subquery()
            )

            result = await session.execute(
                select(Business)
                .options(selectinload(Business.digital_presence))
                .options(selectinload(Business.lead_scores))
                .where(Business.id.notin_(excluded_subq))
            )
            businesses = result.scalars().all()
            stats["total"] = len(businesses)

            logger.info(
                "recalibration_started",
                total_businesses=stats["total"],
            )

            # Cache competitive contexts to avoid redundant recomputation
            context_cache: dict[tuple[str, str], CompetitiveContext] = {}

            for business in businesses:
                try:
                    # Step 1: Re-enrich
                    await enrich_business(session, business)
                    await session.flush()
                    stats["enriched"] += 1

                    # Step 2: Recompute competitive context (once per zip+niche)
                    cache_key = (business.zip_code, business.niche.value)
                    if cache_key not in context_cache:
                        ctx = await compute_competitive_context(
                            session, business.zip_code, business.niche
                        )
                        await session.flush()
                        context_cache[cache_key] = ctx
                    else:
                        ctx = context_cache[cache_key]

                    # Step 3: Compute new composite score
                    scores = compute_composite_score(
                        business, business.digital_presence, ctx
                    )

                    # Step 4: Determine current max version
                    current_version = max(
                        (s.score_version for s in business.lead_scores), default=0
                    )
                    latest_score = next(
                        (
                            s
                            for s in business.lead_scores
                            if s.score_version == current_version
                        ),
                        None,
                    )

                    # Step 5: Create new LeadScore row with bumped version
                    new_version = current_version + 1
                    new_score = LeadScore(
                        id=uuid.uuid4(),
                        business_id=business.id,
                        score_version=new_version,
                        digital_deficit_score=scores["digital_deficit_score"],
                        viability_score=scores["viability_score"],
                        competitive_pressure_score=scores["competitive_pressure_score"],
                        composite_acquisition_score=scores[
                            "composite_acquisition_score"
                        ],
                        price_tier=scores["price_tier"],
                    )
                    session.add(new_score)
                    stats["rescored"] += 1

                    # Step 6: Log significant changes
                    if (
                        latest_score
                        and latest_score.composite_acquisition_score is not None
                    ):
                        old_cas = latest_score.composite_acquisition_score
                        new_cas = scores["composite_acquisition_score"]
                        if old_cas > 0:
                            pct_change = abs(new_cas - old_cas) / old_cas
                        else:
                            pct_change = 1.0 if new_cas > 0 else 0.0

                        if pct_change > threshold:
                            stats["significant_changes"] += 1
                            logger.warning(
                                "score_significant_change",
                                business_id=str(business.id),
                                business_name=business.name,
                                old_score=old_cas,
                                new_score=new_cas,
                                pct_change=round(pct_change * 100, 2),
                            )

                except Exception:
                    stats["errors"] += 1
                    logger.error(
                        "recalibration_business_failed",
                        business_id=str(business.id),
                        business_name=business.name,
                        exc_info=True,
                    )
                    # Flush may be dirty; expunge changes for this business
                    await session.rollback()
                    # Re-open implicit transaction for next business
                    continue

            await session.commit()

        return stats

    try:
        stats = asyncio.run(_run())
        logger.info("recalibration_complete", **stats)
        return stats
    except Exception as exc:
        logger.error("recalibration_task_failed", error=str(exc))
        raise self.retry(exc=exc)
