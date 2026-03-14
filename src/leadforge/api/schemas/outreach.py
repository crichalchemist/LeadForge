import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class OutreachDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    status: str
    retell_call_id: Optional[str] = None
    first_contact_date: Optional[datetime] = None
    last_contact_date: Optional[datetime] = None
    contact_method: Optional[str] = None
    call_transcript: Optional[str] = None
    call_sentiment_score: Optional[float] = None
    call_disposition: Optional[str] = None
    call_attempts: int = 0
    meeting_scheduled: bool = False
    meeting_type: Optional[str] = None
    meeting_datetime: Optional[datetime] = None
    follow_up_count: int = 0
    assigned_to: Optional[str] = None
    notes: Optional[str] = None
    proposal_amount: Optional[float] = None
    contract_amount: Optional[float] = None
    lost_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class OutreachUpdate(BaseModel):
    notes: Optional[str] = None
    assigned_to: Optional[str] = None


class StageTransition(BaseModel):
    new_stage: str


class OutreachListResponse(BaseModel):
    items: list[OutreachDetail]
    total: int
