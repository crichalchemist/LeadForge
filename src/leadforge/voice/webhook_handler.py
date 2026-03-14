import structlog
from fastapi import APIRouter, Request, HTTPException, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.config import settings
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage, CallDisposition
from leadforge.voice.retell_client import verify_retell_signature

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
    """Handle Retell webhook events (call_ended, call_analyzed).

    Retell sends webhooks with structure: {"event": "...", "call": {...}}
    - call_ended: contains transcript, disconnection_reason, but NO call_analysis
    - call_analyzed: contains call_analysis with sentiment and success flag

    Idempotent: updates are additive; re-processing the same event is safe.
    """
    payload_bytes = await request.body()

    # Verify webhook signature if API key is configured
    if settings.RETELL_API_KEY:
        signature = request.headers.get("x-retell-signature", "")
        if signature and not verify_retell_signature(payload_bytes, signature, settings.RETELL_API_KEY):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    body = await request.json()
    event = body.get("event", "")
    call_data = body.get("call", body)  # Fall back to top-level for backward compat

    call_id = call_data.get("call_id")
    if not call_id:
        raise HTTPException(status_code=400, detail="Missing call_id")

    outreach = await _get_outreach_by_call_id(session, call_id)
    if not outreach:
        logger.warning("webhook_unknown_call", call_id=call_id, webhook_event=event)
        return {"status": "ignored", "reason": "unknown call_id"}

    if event == "call_ended":
        _handle_call_ended(outreach, call_data)
    elif event == "call_analyzed":
        _handle_call_analyzed(outreach, call_data)
    else:
        # Legacy / unrecognized event — try to extract what we can
        _handle_call_ended(outreach, call_data)
        if "call_analysis" in call_data:
            _handle_call_analyzed(outreach, call_data)

    await session.commit()
    logger.info("webhook_processed", call_id=call_id, webhook_event=event, disposition=outreach.call_disposition)

    # Dispatch sentiment analysis task if we have a transcript
    if outreach.call_transcript:
        _dispatch_sentiment_task(str(outreach.id))

    return {"status": "ok", "call_id": call_id}


def _handle_call_ended(outreach: OutreachRecord, call_data: dict) -> None:
    """Process call_ended event: transcript, disconnection reason, disposition."""
    transcript = call_data.get("transcript", "")
    if transcript:
        outreach.call_transcript = transcript

    disconnection_reason = call_data.get("disconnection_reason", "")
    if disconnection_reason == "voicemail_reached":
        outreach.call_disposition = CallDisposition.VOICEMAIL
        outreach.status = PipelineStage.VOICEMAIL
    elif disconnection_reason in ("dial_failed", "no_answer", "busy"):
        outreach.call_disposition = CallDisposition.NO_ANSWER
    elif transcript:
        # Had a conversation — mark as answered (may upgrade to ENGAGED on analysis)
        outreach.call_disposition = CallDisposition.ANSWERED
        outreach.status = PipelineStage.CONTACTED


def _handle_call_analyzed(outreach: OutreachRecord, call_data: dict) -> None:
    """Process call_analyzed event: sentiment, success flag."""
    analysis = call_data.get("call_analysis", {})
    if not analysis:
        return

    call_successful = analysis.get("call_successful", False)
    if call_successful:
        outreach.status = PipelineStage.ENGAGED

    sentiment = analysis.get("customer_sentiment")
    if sentiment:
        sentiment_map = {"Negative": -0.7, "Neutral": 0.0, "Positive": 0.7}
        outreach.call_sentiment_score = sentiment_map.get(sentiment, 0.0)


def _dispatch_sentiment_task(outreach_id: str) -> None:
    """Dispatch the sentiment Celery task. Separated for testability."""
    from leadforge.tasks.sentiment_tasks import process_sentiment_task
    process_sentiment_task.delay(outreach_id)


@router.post("/call-event")
async def handle_call_event(request: Request):
    """Handle Retell real-time call events (call_started, transcript_updated, etc.)."""
    body = await request.json()
    event_type = body.get("event")
    call_data = body.get("call", body)
    call_id = call_data.get("call_id")
    logger.info("retell_event", event_type=event_type, call_id=call_id)
    return {"status": "ok"}
