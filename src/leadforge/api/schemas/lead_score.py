import uuid
from typing import Optional
from pydantic import BaseModel, ConfigDict


class ScoreBreakdown(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    business_id: uuid.UUID
    score_version: int
    digital_deficit_score: Optional[float] = None
    viability_score: Optional[float] = None
    competitive_pressure_score: Optional[float] = None
    composite_acquisition_score: Optional[float] = None
    price_tier: Optional[int] = None
    sentiment_adjustment: Optional[float] = None


class RankedLead(BaseModel):
    business_id: uuid.UUID
    business_name: str
    zip_code: str
    niche: str
    composite_acquisition_score: Optional[float] = None
    price_tier: Optional[int] = None
    pipeline_stage: Optional[str] = None


class RankedLeadsResponse(BaseModel):
    items: list[RankedLead]
    total: int
    page: int
    page_size: int
