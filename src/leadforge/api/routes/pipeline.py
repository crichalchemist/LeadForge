import uuid

import structlog
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.api.schemas.outreach import StageTransition
from leadforge.db.models.business import Business
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage

logger = structlog.get_logger()

router = APIRouter(prefix="/pipeline", tags=["pipeline"])

# Valid stage transitions — enforced by backend
VALID_TRANSITIONS: dict[PipelineStage, set[PipelineStage]] = {
    PipelineStage.SCORED: {PipelineStage.QUEUED, PipelineStage.DISQUALIFIED},
    PipelineStage.QUEUED: {PipelineStage.CONTACTED, PipelineStage.DISQUALIFIED},
    PipelineStage.CONTACTED: {
        PipelineStage.VOICEMAIL,
        PipelineStage.ENGAGED,
        PipelineStage.DISQUALIFIED,
        PipelineStage.NURTURE,
    },
    PipelineStage.VOICEMAIL: {
        PipelineStage.CONTACTED,
        PipelineStage.ENGAGED,
        PipelineStage.DISQUALIFIED,
        PipelineStage.NURTURE,
    },
    PipelineStage.ENGAGED: {
        PipelineStage.MEETING_SCHEDULED,
        PipelineStage.LOST,
        PipelineStage.DISQUALIFIED,
        PipelineStage.NURTURE,
    },
    PipelineStage.MEETING_SCHEDULED: {
        PipelineStage.PROPOSAL_SENT,
        PipelineStage.LOST,
        PipelineStage.DISQUALIFIED,
        PipelineStage.NURTURE,
    },
    PipelineStage.PROPOSAL_SENT: {
        PipelineStage.NEGOTIATING,
        PipelineStage.LOST,
        PipelineStage.DISQUALIFIED,
    },
    PipelineStage.NEGOTIATING: {
        PipelineStage.WON,
        PipelineStage.LOST,
        PipelineStage.DISQUALIFIED,
    },
    PipelineStage.WON: set(),
    PipelineStage.LOST: {PipelineStage.NURTURE},
    PipelineStage.DISQUALIFIED: set(),
    PipelineStage.NURTURE: {PipelineStage.QUEUED},
}


class PipelineStageCount(dict):
    pass


@router.get("/board")
async def get_pipeline_board(session: AsyncSession = Depends(get_db)):
    """Get pipeline board with counts and lead previews per stage."""
    # Stage counts
    count_q = select(OutreachRecord.status, func.count(OutreachRecord.id)).group_by(
        OutreachRecord.status
    )
    counts = dict((await session.execute(count_q)).all())

    # Build board columns
    columns = []
    for stage in PipelineStage:
        count = counts.get(stage, 0)

        # Fetch up to 10 preview cards per stage
        preview_q = (
            select(OutreachRecord, Business.name, Business.zip_code, Business.niche)
            .join(Business, OutreachRecord.business_id == Business.id)
            .where(OutreachRecord.status == stage)
            .order_by(OutreachRecord.updated_at.desc())
            .limit(10)
        )
        results = (await session.execute(preview_q)).all()
        cards = [
            {
                "outreach_id": str(row[0].id),
                "business_id": str(row[0].business_id),
                "business_name": row[1],
                "zip_code": row[2],
                "niche": row[3].value if row[3] else None,
                "call_attempts": row[0].call_attempts,
                "last_contact": row[0].last_contact_date.isoformat()
                if row[0].last_contact_date
                else None,
            }
            for row in results
        ]

        columns.append(
            {
                "stage": stage.value,
                "count": count,
                "cards": cards,
            }
        )

    return {"columns": columns}


@router.patch("/{outreach_id}/stage")
async def transition_stage(
    outreach_id: uuid.UUID,
    body: StageTransition,
    session: AsyncSession = Depends(get_db),
):
    """Transition an outreach record to a new pipeline stage.

    Enforces valid transitions per VALID_TRANSITIONS map.
    """
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    outreach = result.scalar_one_or_none()
    if not outreach:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    try:
        new_stage = PipelineStage(body.new_stage)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {body.new_stage}")

    current_stage = outreach.status
    allowed = VALID_TRANSITIONS.get(current_stage, set())
    if new_stage not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot transition from {current_stage.value} to {new_stage.value}. "
            f"Allowed: {[s.value for s in allowed]}",
        )

    outreach.status = new_stage
    await session.commit()
    logger.info(
        "stage_transitioned",
        outreach_id=str(outreach_id),
        from_stage=current_stage.value,
        to_stage=new_stage.value,
    )
    return {
        "status": "ok",
        "outreach_id": str(outreach_id),
        "new_stage": new_stage.value,
    }
