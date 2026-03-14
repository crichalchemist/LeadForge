import uuid
import enum
from typing import Optional
from datetime import date
from sqlalchemy import String, Float, Boolean, Text, Date, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin


class NOFStage(str, enum.Enum):
    ELIGIBILITY_ASSESSED = "eligibility_assessed"
    INTAKE = "intake"
    APPLIED = "applied"
    PIPELINE = "pipeline"
    FINALIST = "finalist"
    STAGE_1_LEGAL = "stage_1_legal"
    STAGE_2_DOCS = "stage_2_docs"
    STAGE_3_FINANCING = "stage_3_financing"
    STAGE_3_CONSTRUCTION = "stage_3_construction"
    STAGE_4_CLOSING = "stage_4_closing"
    STAGE_5_COMPLETE = "stage_5_complete"
    ALUMNUS = "alumnus"
    REMOVED = "removed"


class GrantApplication(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "grant_applications"

    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"), index=True)

    # Status
    status: Mapped[NOFStage] = mapped_column(SAEnum(NOFStage), default=NOFStage.ELIGIBILITY_ASSESSED)

    # Dates
    applied_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    finalist_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    cal_issued_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    completion_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    alumnus_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Financials
    total_project_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    base_grant_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    acquisition_cost: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    acquisition_coverage_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    taf_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    owner_contribution: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    financing_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    financing_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    # Corridor
    corridor_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    corridor_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_priority_corridor: Mapped[bool] = mapped_column(Boolean, default=False)

    # Application
    gc_bid_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    project_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exterior_work_pct: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    has_site_control: Mapped[bool] = mapped_column(Boolean, default=False)
    site_control_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # DEED, LEASE, PURCHASE_AGREEMENT

    # Tracking
    assigned_to: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    ta_provider: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lost_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    business: Mapped["Business"] = relationship(back_populates="grant_applications")
    documents: Mapped[list["GrantDocument"]] = relationship(back_populates="grant_application", cascade="all, delete-orphan")
