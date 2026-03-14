import uuid
from typing import Optional

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.api.deps import get_db
from leadforge.api.schemas.business import (
    BusinessDetail,
    BusinessListItem,
    BusinessListResponse,
    BusinessUpdate,
)
from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord

logger = structlog.get_logger()

router = APIRouter(prefix="/businesses", tags=["businesses"])


@router.get("", response_model=BusinessListResponse)
async def list_businesses(
    session: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    zip_code: Optional[str] = None,
    niche: Optional[NicheType] = None,
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
    stage: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = Query(
        "composite_acquisition_score",
        pattern="^(name|zip_code|composite_acquisition_score|created_at)$",
    ),
    sort_dir: str = Query("desc", pattern="^(asc|desc)$"),
):
    # Build base query
    query = select(Business)

    if zip_code:
        query = query.where(Business.zip_code == zip_code)
    if niche:
        query = query.where(Business.niche == niche)
    if search:
        query = query.where(Business.name.ilike(f"%{search}%"))

    # Score filtering requires join
    if (
        min_score is not None
        or max_score is not None
        or sort_by == "composite_acquisition_score"
    ):
        latest_score = (
            select(
                LeadScore.business_id,
                LeadScore.composite_acquisition_score,
                LeadScore.price_tier,
                func.row_number()
                .over(
                    partition_by=LeadScore.business_id,
                    order_by=LeadScore.score_version.desc(),
                )
                .label("rn"),
            )
        ).subquery()
        latest = select(latest_score).where(latest_score.c.rn == 1).subquery()
        query = query.outerjoin(latest, Business.id == latest.c.business_id)

        if min_score is not None:
            query = query.where(latest.c.composite_acquisition_score >= min_score)
        if max_score is not None:
            query = query.where(latest.c.composite_acquisition_score <= max_score)

    # Stage filtering requires outreach join
    if stage:
        query = query.join(OutreachRecord).where(OutreachRecord.status == stage)

    # Count
    count_q = select(func.count()).select_from(query.subquery())
    total = (await session.execute(count_q)).scalar() or 0

    # Sort
    if sort_by == "composite_acquisition_score" and (
        min_score is not None
        or max_score is not None
        or sort_by == "composite_acquisition_score"
    ):
        order_col = latest.c.composite_acquisition_score
    elif sort_by == "name":
        order_col = Business.name
    elif sort_by == "zip_code":
        order_col = Business.zip_code
    else:
        order_col = Business.created_at

    if sort_dir == "desc":
        order_col = order_col.desc().nullslast()
    else:
        order_col = order_col.asc().nullsfirst()

    query = query.order_by(order_col).offset((page - 1) * page_size).limit(page_size)

    result = await session.execute(query)
    businesses = result.scalars().all()

    # Fetch latest scores and outreach for list items
    items = []
    if businesses:
        biz_ids = [b.id for b in businesses]
        # Latest score per business using window function
        score_with_rn = (
            select(
                LeadScore,
                func.row_number()
                .over(
                    partition_by=LeadScore.business_id,
                    order_by=LeadScore.score_version.desc(),
                )
                .label("rn"),
            ).where(LeadScore.business_id.in_(biz_ids))
        ).subquery()
        score_q = select(LeadScore).join(
            score_with_rn,
            (LeadScore.id == score_with_rn.c.id) & (score_with_rn.c.rn == 1),
        )
        scores_result = await session.execute(score_q)
        scores_map = {s.business_id: s for s in scores_result.scalars().all()}

        # Latest outreach per business
        outreach_with_rn = (
            select(
                OutreachRecord,
                func.row_number()
                .over(
                    partition_by=OutreachRecord.business_id,
                    order_by=OutreachRecord.created_at.desc(),
                )
                .label("rn"),
            ).where(OutreachRecord.business_id.in_(biz_ids))
        ).subquery()
        outreach_q = select(OutreachRecord).join(
            outreach_with_rn,
            (OutreachRecord.id == outreach_with_rn.c.id) & (outreach_with_rn.c.rn == 1),
        )
        outreach_result = await session.execute(outreach_q)
        outreach_map = {o.business_id: o for o in outreach_result.scalars().all()}

        for b in businesses:
            score = scores_map.get(b.id)
            outreach = outreach_map.get(b.id)
            items.append(
                BusinessListItem(
                    id=b.id,
                    name=b.name,
                    address=b.address,
                    zip_code=b.zip_code,
                    phone=b.phone,
                    niche=b.niche,
                    license_status=b.license_status,
                    created_at=b.created_at,
                    composite_acquisition_score=score.composite_acquisition_score
                    if score
                    else None,
                    price_tier=score.price_tier if score else None,
                    pipeline_stage=outreach.status.value if outreach else None,
                )
            )

    return BusinessListResponse(
        items=items, total=total, page=page, page_size=page_size
    )


@router.get("/{business_id}", response_model=BusinessDetail)
async def get_business(business_id: uuid.UUID, session: AsyncSession = Depends(get_db)):
    result = await session.execute(
        select(Business)
        .where(Business.id == business_id)
        .options(
            selectinload(Business.digital_presence),
            selectinload(Business.lead_scores),
            selectinload(Business.outreach_records),
        )
    )
    business = result.scalar_one_or_none()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")
    return business


@router.patch("/{business_id}", response_model=BusinessDetail)
async def update_business(
    business_id: uuid.UUID,
    update: BusinessUpdate,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(Business)
        .where(Business.id == business_id)
        .options(
            selectinload(Business.digital_presence),
            selectinload(Business.lead_scores),
            selectinload(Business.outreach_records),
        )
    )
    business = result.scalar_one_or_none()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(business, field, value)

    await session.commit()

    # Re-fetch with eager loading to avoid MissingGreenlet on relationship access
    result = await session.execute(
        select(Business)
        .where(Business.id == business_id)
        .options(
            selectinload(Business.digital_presence),
            selectinload(Business.lead_scores),
            selectinload(Business.outreach_records),
        )
    )
    business = result.scalar_one()
    logger.info(
        "business_updated",
        business_id=str(business_id),
        fields=list(update_data.keys()),
    )
    return business
