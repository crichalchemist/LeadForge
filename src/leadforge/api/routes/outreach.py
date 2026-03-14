import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.api.deps import get_db
from leadforge.api.schemas.outreach import OutreachDetail, OutreachListResponse, OutreachUpdate
from leadforge.db.models.outreach_record import OutreachRecord

router = APIRouter(prefix="/outreach", tags=["outreach"])


@router.get("/by-business/{business_id}", response_model=OutreachListResponse)
async def get_outreach_history(
    business_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get all outreach records for a business."""
    result = await session.execute(
        select(OutreachRecord)
        .where(OutreachRecord.business_id == business_id)
        .order_by(OutreachRecord.created_at.desc())
    )
    records = result.scalars().all()
    count_result = await session.execute(
        select(func.count(OutreachRecord.id)).where(OutreachRecord.business_id == business_id)
    )
    total = count_result.scalar() or 0
    return OutreachListResponse(items=records, total=total)


@router.get("/{outreach_id}", response_model=OutreachDetail)
async def get_outreach(outreach_id: uuid.UUID, session: AsyncSession = Depends(get_db)):
    """Get a single outreach record with full details including transcript."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    return record


@router.get("/{outreach_id}/transcript")
async def get_transcript(outreach_id: uuid.UUID, session: AsyncSession = Depends(get_db)):
    """Get the call transcript for an outreach record."""
    result = await session.execute(
        select(OutreachRecord.call_transcript, OutreachRecord.retell_call_id)
        .where(OutreachRecord.id == outreach_id)
    )
    row = result.one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Outreach record not found")
    return {"transcript": row[0], "retell_call_id": row[1]}


@router.patch("/{outreach_id}", response_model=OutreachDetail)
async def update_outreach(
    outreach_id: uuid.UUID,
    update: OutreachUpdate,
    session: AsyncSession = Depends(get_db),
):
    """Update notes or assignment for an outreach record."""
    result = await session.execute(
        select(OutreachRecord).where(OutreachRecord.id == outreach_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="Outreach record not found")

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(record, field, value)

    await session.commit()
    await session.refresh(record)
    return record
