import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.outreach_record import OutreachRecord
from leadforge.voice.call_manager import initiate_call, queue_leads_for_outreach
from leadforge.voice.retell_client import RetellClient

logger = structlog.get_logger()


async def run_outreach_pipeline(
    session: AsyncSession,
    zip_code: str,
    niche: NicheType,
    batch_size: int = 10,
    min_score: float = 30.0,
    dry_run: bool = False,
) -> list[OutreachRecord]:
    """Run the outreach pipeline: select leads → queue → generate briefs → call.

    Args:
        session: DB session
        zip_code: Target zip code
        niche: Target niche
        batch_size: Max leads to process
        min_score: Minimum composite score
        dry_run: If True, generate briefs but don't initiate calls

    Returns:
        List of OutreachRecords created/processed.
    """
    logger.info(
        "outreach_pipeline_start",
        zip_code=zip_code,
        niche=niche.value,
        batch_size=batch_size,
    )

    # Step 1: Queue top leads
    queued = await queue_leads_for_outreach(
        session, zip_code, niche, batch_size=batch_size, min_score=min_score
    )
    if not queued:
        logger.info("no_leads_to_outreach", zip_code=zip_code, niche=niche.value)
        return []

    await session.commit()
    logger.info("leads_queued", count=len(queued))

    if dry_run:
        logger.info("dry_run_complete", queued=len(queued))
        return queued

    # Step 2: Initiate calls (one at a time for TCPA compliance)
    async with RetellClient() as retell:
        # Create or reuse agent
        agent = await retell.create_agent(
            name=f"leadforge-{niche.value}",
            prompt="You are a professional marketing consultant reaching out to local businesses.",
        )
        agent_id = agent.get("agent_id") if agent else None
        if not agent_id:
            logger.error("agent_creation_failed")
            return queued

        for outreach in queued:
            # Load business with digital_presence
            result = await session.execute(
                select(Business)
                .options(selectinload(Business.digital_presence))
                .where(Business.id == outreach.business_id)
            )
            business = result.scalar_one_or_none()
            if not business:
                continue

            await initiate_call(session, outreach, business, retell, agent_id)

    await session.commit()
    logger.info("outreach_pipeline_complete", processed=len(queued))
    return queued
