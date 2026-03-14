import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict


class GrantBoardCard(BaseModel):
    grant_id: str
    business_id: str
    business_name: str
    corridor_name: str | None = None
    estimated_grant: float | None = None
    days_in_stage: int = 0


class GrantApplicationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    status: str
    applied_date: date | None = None
    finalist_date: date | None = None
    cal_issued_date: date | None = None
    completion_date: date | None = None
    alumnus_date: date | None = None
    total_project_cost: float | None = None
    base_grant_amount: float | None = None
    acquisition_cost: float | None = None
    acquisition_coverage_pct: float | None = None
    taf_amount: float | None = None
    owner_contribution: float | None = None
    financing_amount: float | None = None
    financing_verified: bool = False
    corridor_name: str | None = None
    corridor_type: str | None = None
    is_priority_corridor: bool = False
    gc_bid_amount: float | None = None
    project_description: str | None = None
    exterior_work_pct: float | None = None
    has_site_control: bool = False
    site_control_type: str | None = None
    assigned_to: str | None = None
    ta_provider: str | None = None
    notes: str | None = None
    lost_reason: str | None = None
    created_at: datetime
    updated_at: datetime


class GrantApplicationCreate(BaseModel):
    business_id: uuid.UUID
    total_project_cost: float | None = None
    acquisition_cost: float | None = None
    project_description: str | None = None


class GrantApplicationUpdate(BaseModel):
    total_project_cost: float | None = None
    base_grant_amount: float | None = None
    acquisition_cost: float | None = None
    taf_amount: float | None = None
    owner_contribution: float | None = None
    financing_amount: float | None = None
    financing_verified: bool | None = None
    gc_bid_amount: float | None = None
    project_description: str | None = None
    exterior_work_pct: float | None = None
    has_site_control: bool | None = None
    site_control_type: str | None = None
    assigned_to: str | None = None
    ta_provider: str | None = None
    notes: str | None = None


class GrantStageTransition(BaseModel):
    new_stage: str


class GrantDocumentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    grant_application_id: uuid.UUID
    document_type: str
    is_mandatory: bool = False
    status: str = "missing"
    notes: str | None = None
    received_date: date | None = None
    reviewed_date: date | None = None
    created_at: datetime
    updated_at: datetime


class GrantDocumentUpdate(BaseModel):
    status: str | None = None
    notes: str | None = None
    received_date: date | None = None
    reviewed_date: date | None = None


class GrantFinancialsResponse(BaseModel):
    total_project_cost: float
    acquisition_cost: float
    base_grant: float
    taf_eligible: float
    owner_contribution: float
    owner_min_financing: float
    exterior_work_minimum: float


class GrantBoardColumn(BaseModel):
    stage: str
    count: int
    cards: list[GrantBoardCard]
