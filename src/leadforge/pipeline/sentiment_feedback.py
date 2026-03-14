import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord, CallDisposition

logger = structlog.get_logger()


async def apply_sentiment_feedback(
    session: AsyncSession,
    outreach: OutreachRecord,
) -> float | None:
    """Apply sentiment-based score adjustment to the business's lead score.

    Per PRD:
    - Positive (>0.3): composite * 1.15
    - Neutral (-0.3 to 0.3): no change
    - Negative (<-0.3): composite * 0.75
    - No answer after 2+ attempts: composite * 0.90

    Returns the adjustment multiplier applied, or None if no adjustment.
    """
    # Get latest lead score for this business
    result = await session.execute(
        select(LeadScore)
        .where(LeadScore.business_id == outreach.business_id)
        .order_by(LeadScore.score_version.desc())
        .limit(1)
    )
    lead_score = result.scalar_one_or_none()
    if not lead_score or lead_score.composite_acquisition_score is None:
        logger.warning("no_lead_score_for_feedback", business_id=str(outreach.business_id))
        return None

    multiplier = _compute_multiplier(outreach)
    if multiplier is None:
        return None

    old_score = lead_score.composite_acquisition_score
    new_score = min(old_score * multiplier, 100.0)
    lead_score.composite_acquisition_score = new_score
    lead_score.sentiment_adjustment = multiplier

    logger.info(
        "sentiment_feedback_applied",
        business_id=str(outreach.business_id),
        old_score=old_score,
        new_score=new_score,
        multiplier=multiplier,
    )
    return multiplier


def _compute_multiplier(outreach: OutreachRecord) -> float | None:
    """Determine the sentiment multiplier based on call outcome."""
    # No-answer path: 2+ unanswered attempts
    if (
        outreach.call_disposition in (CallDisposition.NO_ANSWER, CallDisposition.VOICEMAIL)
        and outreach.call_attempts >= 2
    ):
        return 0.90

    sentiment = outreach.call_sentiment_score
    if sentiment is None:
        return None

    if sentiment > 0.3:
        return 1.15
    elif sentiment < -0.3:
        return 0.75
    # Neutral: no change
    return None
