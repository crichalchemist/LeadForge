import uuid
from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict

from leadforge.db.models.business import LicenseStatus, NicheType


class DigitalPresenceSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    has_website: bool = False
    website_url: Optional[str] = None
    website_quality_score: Optional[float] = None
    has_google_business_profile: bool = False
    gbp_completeness_score: Optional[float] = None
    google_review_count: Optional[int] = 0
    google_avg_rating: Optional[float] = None
    has_facebook_page: bool = False
    has_instagram: bool = False
    ig_follower_count: Optional[int] = None
    has_google_ads: bool = False
    has_meta_ads: bool = False
    yelp_review_count: Optional[int] = None
    yelp_rating: Optional[float] = None


class LeadScoreSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    score_version: int
    digital_deficit_score: Optional[float] = None
    viability_score: Optional[float] = None
    competitive_pressure_score: Optional[float] = None
    composite_acquisition_score: Optional[float] = None
    price_tier: Optional[int] = None
    sentiment_adjustment: Optional[float] = None


class OutreachSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    retell_call_id: Optional[str] = None
    first_contact_date: Optional[datetime] = None
    last_contact_date: Optional[datetime] = None
    call_disposition: Optional[str] = None
    call_attempts: int = 0
    meeting_scheduled: bool = False
    assigned_to: Optional[str] = None
    notes: Optional[str] = None


class BusinessListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    address: Optional[str] = None
    zip_code: str
    phone: Optional[str] = None
    niche: NicheType
    license_status: Optional[LicenseStatus] = None
    created_at: datetime
    # Flattened score fields for list view
    composite_acquisition_score: Optional[float] = None
    price_tier: Optional[int] = None
    pipeline_stage: Optional[str] = None


class BusinessDetail(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    address: Optional[str] = None
    zip_code: str
    phone: Optional[str] = None
    email: Optional[str] = None
    owner_name: Optional[str] = None
    niche: NicheType
    license_number: Optional[str] = None
    license_status: Optional[LicenseStatus] = None
    license_issue_date: Optional[date] = None
    incorporation_date: Optional[date] = None
    employee_count_est: Optional[int] = None
    estimated_monthly_revenue: Optional[float] = None
    google_place_id: Optional[str] = None
    thumbtack_hires: Optional[int] = None
    nextdoor_recommendations: Optional[int] = None
    total_customer_ugc: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    digital_presence: Optional[DigitalPresenceSummary] = None
    lead_scores: list[LeadScoreSummary] = []
    outreach_records: list[OutreachSummary] = []


class BusinessUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    owner_name: Optional[str] = None
    notes: Optional[str] = None


class BusinessListResponse(BaseModel):
    items: list[BusinessListItem]
    total: int
    page: int
    page_size: int
