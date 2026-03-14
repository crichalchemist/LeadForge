from __future__ import annotations

import enum
import uuid
from datetime import date
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Date, ForeignKey, String, Text
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from leadforge.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from leadforge.db.models.grant_application import GrantApplication


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

    grant_application_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("grant_applications.id", ondelete="CASCADE"), index=True
    )

    # Document info
    document_type: Mapped[DocumentType] = mapped_column(SAEnum(DocumentType, values_callable=lambda e: [x.value for x in e]))
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(
        String(20), default="missing"
    )  # missing, requested, received, approved, rejected

    # Tracking
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    received_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    reviewed_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Relationship
    grant_application: Mapped["GrantApplication"] = relationship(
        back_populates="documents"
    )
