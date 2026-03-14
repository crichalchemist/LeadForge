import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.api.schemas.lead_score import RankedLead, RankedLeadsResponse, ScoreBreakdown
from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("/ranked", response_model=RankedLeadsResponse)
async def get_ranked_leads(
    session: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    zip_code: Optional[str] = None,
    niche: Optional[NicheType] = None,
    min_score: Optional[float] = None,
    price_tier: Optional[int] = None,
):
    """Get leads ranked by composite acquisition score."""
    # Latest score per business via window function
    latest_score = (
        select(
            LeadScore.business_id,
            LeadScore.composite_acquisition_score,
            LeadScore.price_tier,
            func.row_number()
            .over(partition_by=LeadScore.business_id, order_by=LeadScore.score_version.desc())
            .label("rn"),
        )
    ).subquery()
    latest = select(latest_score).where(latest_score.c.rn == 1).subquery()

    query = (
        select(
            Business.id,
            Business.name,
            Business.zip_code,
            Business.niche,
            latest.c.composite_acquisition_score,
            latest.c.price_tier,
        )
        .outerjoin(latest, Business.id == latest.c.business_id)
    )

    if zip_code:
        query = query.where(Business.zip_code == zip_code)
    if niche:
        query = query.where(Business.niche == niche)
    if min_score is not None:
        query = query.where(latest.c.composite_acquisition_score >= min_score)
    if price_tier is not None:
        query = query.where(latest.c.price_tier == price_tier)

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_q)).scalar() or 0

    # Sort + paginate
    query = (
        query.order_by(latest.c.composite_acquisition_score.desc().nullslast())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    rows = (await session.execute(query)).all()

    # Fetch latest outreach stages for these businesses
    biz_ids = [r[0] for r in rows]
    outreach_map = {}
    if biz_ids:
        lo_sub = (
            select(
                OutreachRecord.business_id,
                OutreachRecord.status,
                func.row_number()
                .over(partition_by=OutreachRecord.business_id, order_by=OutreachRecord.created_at.desc())
                .label("rn"),
            )
            .where(OutreachRecord.business_id.in_(biz_ids))
        ).subquery()
        outreach_q = select(lo_sub.c.business_id, lo_sub.c.status).where(lo_sub.c.rn == 1)
        outreach_rows = (await session.execute(outreach_q)).all()
        outreach_map = {r[0]: r[1] for r in outreach_rows}

    items = [
        RankedLead(
            business_id=r[0],
            business_name=r[1],
            zip_code=r[2],
            niche=r[3].value if r[3] else "",
            composite_acquisition_score=r[4],
            price_tier=r[5],
            pipeline_stage=outreach_map.get(r[0]),
        )
        for r in rows
    ]

    return RankedLeadsResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/{business_id}/score", response_model=list[ScoreBreakdown])
async def get_score_history(business_id: uuid.UUID, session: AsyncSession = Depends(get_db)):
    """Get all score versions for a business (audit trail)."""
    result = await session.execute(
        select(LeadScore)
        .where(LeadScore.business_id == business_id)
        .order_by(LeadScore.score_version.desc())
    )
    scores = result.scalars().all()
    if not scores:
        raise HTTPException(status_code=404, detail="No scores found for this business")
    return scores
