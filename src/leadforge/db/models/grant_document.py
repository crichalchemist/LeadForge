import uuid
import enum
from typing import Optional
from datetime import date
from sqlalchemy import String, Boolean, Text, Date, ForeignKey, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin


class DocumentType(str, enum.Enum):
    SITE_CONTROL = "site_control"
    GC_BID = "gc_bid"
    BANK_STATEMENT = "bank_statement"
    ARCHITECTURAL_DRAWINGS = "architectural_drawings"
    BUSINESS_PLAN = "business_plan"
    STRATEGIC_PLAN = "strategic_plan"
    ECONOMIC_DISCLOSURE = "economic_disclosure"
    SCOFFLAW_CLEARANCE = "scofflaw_clearance"
    PERMIT = "permit"
    INSURANCE = "insurance"
    CONSTRUCTION_TIMELINE = "construction_timeline"
    COMPLETION_SURVEY = "completion_survey"
    WAIVERS_OF_LIEN = "waivers_of_lien"
    CERTIFICATE_OF_OCCUPANCY = "certificate_of_occupancy"


class GrantDocument(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "grant_documents"

    grant_application_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("grant_applications.id", ondelete="CASCADE"), index=True)

    # Document info
    document_type: Mapped[DocumentType] = mapped_column(SAEnum(DocumentType))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(20), default="missing")  # missing, requested, received, approved, rejected

    # Tracking
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    received_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reviewed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Relationship
    grant_application: Mapped["GrantApplication"] = relationship(back_populates="documents")
