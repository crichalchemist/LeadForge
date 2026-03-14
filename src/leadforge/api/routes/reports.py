import statistics

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.api.schemas.reports import (
    FunnelResponse,
    FunnelStage,
    ScoreBucket,
    ScoreDistributionResponse,
    ZipPerformanceItem,
    ZipPerformanceResponse,
)
from leadforge.db.models.business import Business
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/funnel", response_model=FunnelResponse)
async def get_conversion_funnel(session: AsyncSession = Depends(get_db)):
    """Get pipeline funnel with counts per stage."""
    result = await session.execute(
        select(OutreachRecord.status, func.count(OutreachRecord.id))
        .group_by(OutreachRecord.status)
    )
    stage_counts = dict(result.all())

    stages = []
    total = 0
    for stage in PipelineStage:
        count = stage_counts.get(stage, 0)
        stages.append(FunnelStage(stage=stage.value, count=count))
        total += count

    return FunnelResponse(stages=stages, total=total)


@router.get("/score-distribution", response_model=ScoreDistributionResponse)
async def get_score_distribution(session: AsyncSession = Depends(get_db)):
    """Get histogram of composite acquisition scores (latest version per business)."""
    # Latest score per business
    latest_score = (
        select(
            LeadScore.composite_acquisition_score,
            func.row_number()
            .over(partition_by=LeadScore.business_id, order_by=LeadScore.score_version.desc())
            .label("rn"),
        )
    ).subquery()

    result = await session.execute(
        select(latest_score.c.composite_acquisition_score)
        .where(latest_score.c.rn == 1)
        .where(latest_score.c.composite_acquisition_score.isnot(None))
    )
    scores = [row[0] for row in result.all()]

    # Build 10 buckets of width 10 (0-10, 10-20, ..., 90-100)
    buckets = []
    for i in range(0, 100, 10):
        count = sum(1 for s in scores if i <= s < i + 10) if i < 90 else sum(1 for s in scores if i <= s <= 100)
        buckets.append(ScoreBucket(range_min=float(i), range_max=float(i + 10), count=count))

    mean_val = statistics.mean(scores) if scores else None
    median_val = statistics.median(scores) if scores else None

    return ScoreDistributionResponse(
        buckets=buckets,
        total=len(scores),
        mean=round(mean_val, 2) if mean_val is not None else None,
        median=round(median_val, 2) if median_val is not None else None,
    )


@router.get("/zip-performance", response_model=ZipPerformanceResponse)
async def get_zip_performance(session: AsyncSession = Depends(get_db)):
    """Get per-zip-code performance metrics."""
    # Latest score per business
    latest_score = (
        select(
            LeadScore.business_id,
            LeadScore.composite_acquisition_score,
            func.row_number()
            .over(partition_by=LeadScore.business_id, order_by=LeadScore.score_version.desc())
            .label("rn"),
        )
    ).subquery()
    latest = select(latest_score).where(latest_score.c.rn == 1).subquery()

    # Latest outreach per business
    latest_outreach = (
        select(
            OutreachRecord.business_id,
            OutreachRecord.status,
            func.row_number()
            .over(partition_by=OutreachRecord.business_id, order_by=OutreachRecord.created_at.desc())
            .label("rn"),
        )
    ).subquery()
    lo = select(latest_outreach).where(latest_outreach.c.rn == 1).subquery()

    result = await session.execute(
        select(
            Business.zip_code,
            func.count(Business.id).label("total_leads"),
            func.avg(latest.c.composite_acquisition_score).label("avg_score"),
            func.sum(case(
                (lo.c.status.in_([
                    PipelineStage.CONTACTED, PipelineStage.VOICEMAIL,
                    PipelineStage.ENGAGED, PipelineStage.MEETING_SCHEDULED,
                    PipelineStage.PROPOSAL_SENT, PipelineStage.NEGOTIATING,
                    PipelineStage.WON,
                ]), 1),
                else_=0,
            )).label("contacted"),
            func.sum(case(
                (lo.c.status.in_([
                    PipelineStage.ENGAGED, PipelineStage.MEETING_SCHEDULED,
                    PipelineStage.PROPOSAL_SENT, PipelineStage.NEGOTIATING,
                    PipelineStage.WON,
                ]), 1),
                else_=0,
            )).label("engaged"),
            func.sum(case((lo.c.status == PipelineStage.WON, 1), else_=0)).label("won"),
        )
        .outerjoin(latest, Business.id == latest.c.business_id)
        .outerjoin(lo, Business.id == lo.c.business_id)
        .group_by(Business.zip_code)
        .order_by(func.count(Business.id).desc())
    )

    items = []
    for row in result.all():
        total = row[1]
        contacted = row[3] or 0
        won = row[5] or 0
        items.append(
            ZipPerformanceItem(
                zip_code=row[0],
                total_leads=total,
                avg_composite_score=round(row[2], 2) if row[2] else None,
                contacted_count=contacted,
                engaged_count=row[4] or 0,
                won_count=won,
                conversion_rate=round(won / total * 100, 1) if total > 0 else None,
            )
        )

    return ZipPerformanceResponse(items=items)
