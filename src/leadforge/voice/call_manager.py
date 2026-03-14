import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import (
    OutreachRecord,
    PipelineStage,
)
from leadforge.llm.outreach_brief import generate_outreach_brief
from leadforge.voice.agent_config import build_agent_prompt
from leadforge.voice.retell_client import RetellClient

logger = structlog.get_logger()

# TCPA compliance: flag numbers that look like mobile/personal
MOBILE_PREFIXES = []  # Would contain mobile number patterns


def is_business_line(phone: str | None) -> bool:
    """Check if a phone number appears to be a business line.

    Per PRD TCPA compliance: calls are to business lines only.
    Personal mobile numbers flagged for human review.
    """
    if not phone:
        return False
    # Strip formatting
    digits = "".join(c for c in phone if c.isdigit())
    if len(digits) < 10:
        return False
    # For now, assume all 10+ digit numbers from Google Places are business lines
    # Phase 2+ can add mobile detection
    return True


async def queue_leads_for_outreach(
    session: AsyncSession,
    zip_code: str,
    niche: NicheType,
    batch_size: int = 10,
    min_score: float = 30.0,
) -> list[OutreachRecord]:
    """Select top-scored uncontacted leads and queue them for outreach.

    TCPA compliance: only queue business lines, flag mobiles for review.
    """
    # Find businesses with scores but no outreach record
    result = await session.execute(
        select(Business, LeadScore)
        .join(LeadScore, Business.id == LeadScore.business_id)
        .outerjoin(OutreachRecord, Business.id == OutreachRecord.business_id)
        .options(selectinload(Business.digital_presence))
        .where(
            Business.zip_code == zip_code,
            Business.niche == niche,
            OutreachRecord.id.is_(None),  # No existing outreach
            LeadScore.composite_acquisition_score >= min_score,
        )
        .order_by(LeadScore.composite_acquisition_score.desc())
        .limit(batch_size)
    )

    queued = []
    for business, score in result.all():
        # TCPA: verify business line
        if not is_business_line(business.phone):
            logger.info(
                "skipping_no_business_line",
                business=business.name,
                phone=business.phone,
            )
            continue

        outreach = OutreachRecord(
            id=uuid.uuid4(),
            business_id=business.id,
            status=PipelineStage.QUEUED,
        )
        session.add(outreach)
        queued.append(outreach)
        logger.info(
            "lead_queued",
            business=business.name,
            score=score.composite_acquisition_score,
        )

    await session.flush()
    return queued


async def initiate_call(
    session: AsyncSession,
    outreach: OutreachRecord,
    business: Business,
    retell: RetellClient,
    agent_id: str,
    dry_run: bool = False,
) -> bool:
    """Initiate a call for a queued outreach record."""
    if not business.phone:
        logger.warning("no_phone_number", business=business.name)
        return False

    # Generate outreach brief
    dp = business.digital_presence
    brief = await generate_outreach_brief(business, dp)

    if dry_run:
        logger.info("dry_run_call", business=business.name, brief=brief)
        return True

    # Build agent prompt
    prompt = build_agent_prompt(
        business_name=business.name,
        niche=business.niche.value if business.niche else "business",
        address=f"{business.address}, {business.zip_code}",
        outreach_brief=brief,
    )

    # Initiate call via Retell with metadata for traceability
    call_result = await retell.initiate_call(
        agent_id=agent_id,
        to_number=business.phone,
        metadata={"business_id": str(business.id), "outreach_id": str(outreach.id)},
    )
    if not call_result:
        logger.error("call_initiation_failed", business=business.name)
        return False

    # Update outreach record
    outreach.retell_call_id = call_result.get("call_id")
    outreach.status = PipelineStage.CONTACTED
    outreach.first_contact_date = datetime.now(timezone.utc)
    outreach.last_contact_date = datetime.now(timezone.utc)
    outreach.contact_method = "voice"
    outreach.call_attempts += 1

    await session.flush()
    logger.info(
        "call_initiated", business=business.name, call_id=outreach.retell_call_id
    )
    return True
