import uuid

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.competitive_context import CompetitiveContext
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.db.models.lead_score import LeadScore
from leadforge.scrapers.census import CensusClient

logger = structlog.get_logger()


async def compute_competitive_context(
    session: AsyncSession,
    zip_code: str,
    niche: NicheType,
) -> CompetitiveContext:
    """Compute or update competitive context for a zip+niche pair."""

    # Count competitors in this zip+niche
    count_result = await session.execute(
        select(func.count(Business.id)).where(
            Business.zip_code == zip_code,
            Business.niche == niche,
        )
    )
    competitor_count = count_result.scalar() or 0

    # Average digital deficit score
    avg_score_result = await session.execute(
        select(func.avg(LeadScore.digital_deficit_score))
        .join(Business, LeadScore.business_id == Business.id)
        .where(
            Business.zip_code == zip_code,
            Business.niche == niche,
        )
    )
    avg_digital_score = avg_score_result.scalar()

    # Average rating
    avg_rating_result = await session.execute(
        select(func.avg(DigitalPresence.google_avg_rating))
        .join(Business, DigitalPresence.business_id == Business.id)
        .where(
            Business.zip_code == zip_code,
            Business.niche == niche,
        )
    )
    avg_rating = avg_rating_result.scalar()

    # Count businesses with active ads
    ads_count_result = await session.execute(
        select(func.count(DigitalPresence.id))
        .join(Business, DigitalPresence.business_id == Business.id)
        .where(
            Business.zip_code == zip_code,
            Business.niche == niche,
            DigitalPresence.has_google_ads.is_(True)
            | DigitalPresence.has_meta_ads.is_(True),
        )
    )
    ads_count = ads_count_result.scalar() or 0

    # Get or create CompetitiveContext
    existing = await session.execute(
        select(CompetitiveContext).where(
            CompetitiveContext.zip_code == zip_code,
            CompetitiveContext.niche == niche,
        )
    )
    ctx = existing.scalar_one_or_none()

    if ctx is None:
        ctx = CompetitiveContext(
            id=uuid.uuid4(),
            zip_code=zip_code,
            niche=niche,
        )
        session.add(ctx)

    ctx.competitor_count = competitor_count
    ctx.avg_digital_score = avg_digital_score
    ctx.avg_rating = avg_rating
    ctx.competitor_ads_active_count = ads_count

    # Fetch census demographics (if not already cached)
    if ctx.median_household_income is None:
        async with CensusClient() as census:
            demographics = await census.get_zip_demographics(zip_code)
            if demographics:
                ctx.median_household_income = demographics.get(
                    "median_household_income"
                )
                ctx.population_density = demographics.get("population_density")

    await session.flush()
    logger.info(
        "competitive_context_computed",
        zip_code=zip_code,
        niche=niche.value,
        competitors=competitor_count,
    )
    return ctx
