import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore
from leadforge.scoring.competitive_context import compute_competitive_context
from leadforge.scoring.composite import compute_composite_score

logger = structlog.get_logger()


async def run_scoring_pipeline(
    session: AsyncSession,
    zip_code: str,
    niche: NicheType,
) -> int:
    """Compute full 3-factor scores for all businesses in a zip+niche.

    Returns count of businesses scored.
    """
    # Step 1: Compute/update competitive context
    context = await compute_competitive_context(session, zip_code, niche)

    # Step 2: Load all businesses with their digital presence
    result = await session.execute(
        select(Business)
        .options(selectinload(Business.digital_presence))
        .options(selectinload(Business.lead_scores))
        .where(Business.zip_code == zip_code, Business.niche == niche)
    )
    businesses = result.scalars().all()

    scored_count = 0
    for business in businesses:
        scores = compute_composite_score(business, business.digital_presence, context)

        # Find or create the latest score record
        current_version = max(
            (s.score_version for s in business.lead_scores), default=0
        )

        # Check if score has changed significantly
        latest_score = next(
            (s for s in business.lead_scores if s.score_version == current_version),
            None,
        )

        if (
            latest_score
            and latest_score.composite_acquisition_score
            == scores["composite_acquisition_score"]
        ):
            continue  # No change, skip

        import uuid

        new_score = LeadScore(
            id=uuid.uuid4(),
            business_id=business.id,
            score_version=current_version + 1,
            digital_deficit_score=scores["digital_deficit_score"],
            viability_score=scores["viability_score"],
            competitive_pressure_score=scores["competitive_pressure_score"],
            composite_acquisition_score=scores["composite_acquisition_score"],
            price_tier=scores["price_tier"],
        )
        session.add(new_score)
        scored_count += 1

    await session.commit()
    logger.info(
        "scoring_pipeline_complete",
        zip_code=zip_code,
        niche=niche.value,
        scored=scored_count,
    )
    return scored_count
