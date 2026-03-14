import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from leadforge.api.deps import get_db
from leadforge.api.schemas.grant import (
    GrantApplicationCreate,
    GrantApplicationResponse,
    GrantApplicationUpdate,
    GrantBoardCard,
    GrantBoardColumn,
    GrantDocumentResponse,
    GrantDocumentUpdate,
    GrantFinancialsResponse,
    GrantStageTransition,
)
from leadforge.db.models.business import Business
from leadforge.db.models.grant_application import GrantApplication, NOFStage
from leadforge.db.models.grant_document import GrantDocument
from leadforge.grants.financial_calculator import compute_grant_financials

logger = structlog.get_logger()

router = APIRouter(prefix="/grants", tags=["grants"])

# Valid stage transitions — enforced by backend
VALID_NOF_TRANSITIONS: dict[NOFStage, set[NOFStage]] = {
    NOFStage.ELIGIBILITY_ASSESSED: {NOFStage.INTAKE, NOFStage.REMOVED},
    NOFStage.INTAKE: {NOFStage.APPLIED, NOFStage.REMOVED},
    NOFStage.APPLIED: {NOFStage.PIPELINE, NOFStage.REMOVED},
    NOFStage.PIPELINE: {NOFStage.FINALIST, NOFStage.REMOVED},
    NOFStage.FINALIST: {NOFStage.STAGE_1_LEGAL, NOFStage.REMOVED},
    NOFStage.STAGE_1_LEGAL: {NOFStage.STAGE_2_DOCS, NOFStage.REMOVED},
    NOFStage.STAGE_2_DOCS: {NOFStage.STAGE_3_FINANCING, NOFStage.REMOVED},
    NOFStage.STAGE_3_FINANCING: {NOFStage.STAGE_3_CONSTRUCTION, NOFStage.REMOVED},
    NOFStage.STAGE_3_CONSTRUCTION: {NOFStage.STAGE_4_CLOSING, NOFStage.REMOVED},
    NOFStage.STAGE_4_CLOSING: {NOFStage.STAGE_5_COMPLETE, NOFStage.REMOVED},
    NOFStage.STAGE_5_COMPLETE: {NOFStage.ALUMNUS, NOFStage.REMOVED},
    NOFStage.ALUMNUS: set(),
    NOFStage.REMOVED: set(),
}

# Board groupings
BOARD_GROUPS = {
    "Pre-Application": [
        NOFStage.ELIGIBILITY_ASSESSED,
        NOFStage.INTAKE,
        NOFStage.APPLIED,
        NOFStage.PIPELINE,
    ],
    "Active Grant": [
        NOFStage.FINALIST,
        NOFStage.STAGE_1_LEGAL,
        NOFStage.STAGE_2_DOCS,
        NOFStage.STAGE_3_FINANCING,
        NOFStage.STAGE_3_CONSTRUCTION,
        NOFStage.STAGE_4_CLOSING,
        NOFStage.STAGE_5_COMPLETE,
    ],
    "Complete": [
        NOFStage.ALUMNUS,
        NOFStage.REMOVED,
    ],
}


@router.get("/board")
async def get_grant_board(session: AsyncSession = Depends(get_db)):
    """Get grant Kanban board grouped by stage."""
    # Stage counts
    count_q = select(GrantApplication.status, func.count(GrantApplication.id)).group_by(
        GrantApplication.status
    )
    counts = dict((await session.execute(count_q)).all())

    columns = []
    for group_name, stages in BOARD_GROUPS.items():
        for stage in stages:
            count = counts.get(stage, 0)

            # Fetch up to 10 preview cards per stage
            preview_q = (
                select(GrantApplication, Business.name)
                .join(Business, GrantApplication.business_id == Business.id)
                .where(GrantApplication.status == stage)
                .order_by(GrantApplication.updated_at.desc())
                .limit(10)
            )
            results = (await session.execute(preview_q)).all()

            now = datetime.now(timezone.utc)
            cards = [
                GrantBoardCard(
                    grant_id=str(row[0].id),
                    business_id=str(row[0].business_id),
                    business_name=row[1],
                    corridor_name=row[0].corridor_name,
                    estimated_grant=row[0].base_grant_amount,
                    days_in_stage=(now - row[0].updated_at).days
                    if row[0].updated_at
                    else 0,
                )
                for row in results
            ]

            columns.append(
                GrantBoardColumn(
                    stage=stage.value,
                    count=count,
                    cards=cards,
                )
            )

    return {"columns": [col.model_dump() for col in columns]}


@router.get("/financials/{grant_id}", response_model=GrantFinancialsResponse)
async def get_grant_financials(
    grant_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Compute grant financials for an application."""
    result = await session.execute(
        select(GrantApplication).where(GrantApplication.id == grant_id)
    )
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant application not found")

    financials = compute_grant_financials(
        total_project_cost=grant.total_project_cost or 0.0,
        acquisition_cost=grant.acquisition_cost or 0.0,
    )
    return GrantFinancialsResponse(
        total_project_cost=financials.total_project_cost,
        acquisition_cost=financials.acquisition_cost,
        base_grant=financials.base_grant,
        taf_eligible=financials.taf_eligible,
        owner_contribution=financials.owner_contribution,
        owner_min_financing=financials.owner_min_financing,
        exterior_work_minimum=financials.exterior_work_minimum,
    )


@router.get("/{grant_id}", response_model=GrantApplicationResponse)
async def get_grant(
    grant_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get full grant application detail with documents."""
    result = await session.execute(
        select(GrantApplication)
        .options(selectinload(GrantApplication.documents))
        .where(GrantApplication.id == grant_id)
    )
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant application not found")
    return grant


@router.get("/", response_model=list[GrantApplicationResponse])
async def list_grants(
    status: str | None = Query(None),
    corridor_name: str | None = Query(None),
    business_id: uuid.UUID | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    session: AsyncSession = Depends(get_db),
):
    """List grant applications with filters."""
    stmt = select(GrantApplication)

    if status:
        try:
            stage = NOFStage(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
        stmt = stmt.where(GrantApplication.status == stage)

    if corridor_name:
        stmt = stmt.where(GrantApplication.corridor_name == corridor_name)

    if business_id:
        stmt = stmt.where(GrantApplication.business_id == business_id)

    stmt = stmt.order_by(GrantApplication.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    result = await session.execute(stmt)
    grants = result.scalars().all()
    return grants


@router.post("/", response_model=GrantApplicationResponse, status_code=201)
async def create_grant(
    body: GrantApplicationCreate,
    session: AsyncSession = Depends(get_db),
):
    """Create a new grant application."""
    # Verify business exists
    biz_result = await session.execute(
        select(Business).where(Business.id == body.business_id)
    )
    if not biz_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Business not found")

    grant = GrantApplication(
        business_id=body.business_id,
        status=NOFStage.ELIGIBILITY_ASSESSED,
        total_project_cost=body.total_project_cost,
        acquisition_cost=body.acquisition_cost,
        project_description=body.project_description,
    )
    session.add(grant)
    await session.commit()
    await session.refresh(grant)
    logger.info("grant_application_created", grant_id=str(grant.id))
    return grant


@router.patch("/{grant_id}", response_model=GrantApplicationResponse)
async def update_grant(
    grant_id: uuid.UUID,
    body: GrantApplicationUpdate,
    session: AsyncSession = Depends(get_db),
):
    """Partially update a grant application."""
    result = await session.execute(
        select(GrantApplication).where(GrantApplication.id == grant_id)
    )
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant application not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(grant, field, value)

    await session.commit()
    await session.refresh(grant)
    logger.info("grant_application_updated", grant_id=str(grant_id))
    return grant


@router.patch("/{grant_id}/stage")
async def transition_grant_stage(
    grant_id: uuid.UUID,
    body: GrantStageTransition,
    session: AsyncSession = Depends(get_db),
):
    """Transition a grant application to a new stage."""
    result = await session.execute(
        select(GrantApplication).where(GrantApplication.id == grant_id)
    )
    grant = result.scalar_one_or_none()
    if not grant:
        raise HTTPException(status_code=404, detail="Grant application not found")

    try:
        new_stage = NOFStage(body.new_stage)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {body.new_stage}")

    current_stage = grant.status
    allowed = VALID_NOF_TRANSITIONS.get(current_stage, set())
    if new_stage not in allowed:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Cannot transition from {current_stage.value} "
                f"to {new_stage.value}. "
                f"Allowed: {[s.value for s in allowed]}"
            ),
        )

    grant.status = new_stage
    await session.commit()
    logger.info(
        "grant_stage_transitioned",
        grant_id=str(grant_id),
        from_stage=current_stage.value,
        to_stage=new_stage.value,
    )
    return {
        "status": "ok",
        "grant_id": str(grant_id),
        "new_stage": new_stage.value,
    }


@router.get("/{grant_id}/documents", response_model=list[GrantDocumentResponse])
async def list_grant_documents(
    grant_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
):
    """Get document checklist for a grant application."""
    # Verify grant exists
    grant_result = await session.execute(
        select(GrantApplication).where(GrantApplication.id == grant_id)
    )
    if not grant_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Grant application not found")

    result = await session.execute(
        select(GrantDocument).where(GrantDocument.grant_application_id == grant_id)
    )
    return result.scalars().all()


@router.patch("/{grant_id}/documents/{doc_id}", response_model=GrantDocumentResponse)
async def update_grant_document(
    grant_id: uuid.UUID,
    doc_id: uuid.UUID,
    body: GrantDocumentUpdate,
    session: AsyncSession = Depends(get_db),
):
    """Update a grant document status."""
    result = await session.execute(
        select(GrantDocument).where(
            GrantDocument.id == doc_id,
            GrantDocument.grant_application_id == grant_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Grant document not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(doc, field, value)

    await session.commit()
    await session.refresh(doc)
    logger.info("grant_document_updated", doc_id=str(doc_id), grant_id=str(grant_id))
    return doc
