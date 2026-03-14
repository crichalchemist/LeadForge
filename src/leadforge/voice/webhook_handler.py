import structlog
from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage, CallDisposition

logger = structlog.get_logger()

router = APIRouter(prefix="/webhooks/retell", tags=["webhooks"])


async def _get_outreach_by_call_id(session: AsyncSession, call_id: str) -> OutreachRecord | None:
    """Find outreach record by Retell call ID."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.retell_call_id == call_id)
    )
    return result.scalar_one_or_none()


@router.post("/call-complete")
async def handle_call_complete(request: Request, session: AsyncSession = Depends(get_db)):
    """Handle Retell call completion webhook.

    Idempotent: if already processed, returns 200.
    """
    body = await request.json()
    call_id = body.get("call_id")

    if not call_id:
        raise HTTPException(status_code=400, detail="Missing call_id")

    outreach = await _get_outreach_by_call_id(session, call_id)
    if not outreach:
        logger.warning("webhook_unknown_call", call_id=call_id)
        return {"status": "ignored", "reason": "unknown call_id"}

    # Update outreach record
    transcript = body.get("transcript", "")
    disposition = body.get("call_analysis", {}).get("call_successful", False)

    outreach.call_transcript = transcript

    # Map Retell disposition
    disconnection_reason = body.get("disconnection_reason", "")
    if disconnection_reason == "voicemail_reached":
        outreach.call_disposition = CallDisposition.VOICEMAIL
        outreach.status = PipelineStage.VOICEMAIL
    elif disposition:
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.status = PipelineStage.ENGAGED
    else:
        outreach.call_disposition = CallDisposition.NO_ANSWER

    # Extract sentiment if available from Retell's built-in analysis
    sentiment = body.get("call_analysis", {}).get("customer_sentiment")
    if sentiment:
        sentiment_map = {"Negative": -0.7, "Neutral": 0.0, "Positive": 0.7}
        outreach.call_sentiment_score = sentiment_map.get(sentiment, 0.0)

    await session.commit()
    logger.info("webhook_processed", call_id=call_id, disposition=outreach.call_disposition)

    # Dispatch sentiment analysis + feedback task (LLM-based, asynchronous)
    from leadforge.tasks.sentiment_tasks import process_sentiment_task
    process_sentiment_task.delay(str(outreach.id))

    return {"status": "ok", "call_id": call_id}


@router.post("/call-event")
async def handle_call_event(request: Request):
    """Handle Retell real-time call events (optional)."""
    body = await request.json()
    event_type = body.get("event")
    call_id = body.get("call_id")
    logger.info("retell_event", event=event_type, call_id=call_id)
    return {"status": "ok"}
