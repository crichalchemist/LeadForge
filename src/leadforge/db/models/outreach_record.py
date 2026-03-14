from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from leadforge.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from leadforge.db.models.business import Business


class PipelineStage(str, enum.Enum):
    SCORED = "scored"
    QUEUED = "queued"
    CONTACTED = "contacted"
    VOICEMAIL = "voicemail"
    ENGAGED = "engaged"
    MEETING_SCHEDULED = "meeting_scheduled"
    PROPOSAL_SENT = "proposal_sent"
    NEGOTIATING = "negotiating"
    WON = "won"
    LOST = "lost"
    DISQUALIFIED = "disqualified"
    NURTURE = "nurture"


class CallDisposition(str, enum.Enum):
    ANSWERED = "answered"
    VOICEMAIL = "voicemail"
    NO_ANSWER = "no_answer"
    WRONG_NUMBER = "wrong_number"


class MeetingType(str, enum.Enum):
    VIRTUAL = "virtual"
    IN_PERSON = "in_person"


class OutreachRecord(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "outreach_records"

    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), index=True
    )

    # Pipeline status
    status: Mapped[PipelineStage] = mapped_column(
        SAEnum(PipelineStage), default=PipelineStage.SCORED
    )

    # Retell integration
    retell_call_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Contact info
    first_contact_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_contact_date: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    contact_method: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True
    )  # voice/email/sms/in_person

    # Call data
    call_transcript: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    call_sentiment_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )  # -1 to 1
    call_disposition: Mapped[Optional[CallDisposition]] = mapped_column(
        SAEnum(CallDisposition), nullable=True
    )
    call_attempts: Mapped[int] = mapped_column(Integer, default=0)

    # Meeting
    meeting_scheduled: Mapped[bool] = mapped_column(Boolean, default=False)
    meeting_type: Mapped[Optional[MeetingType]] = mapped_column(
        SAEnum(MeetingType), nullable=True
    )
    meeting_datetime: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Follow-up
    follow_up_count: Mapped[int] = mapped_column(Integer, default=0)
    assigned_to: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Financials
    proposal_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    contract_amount: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lost_reason: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Relationship
    business: Mapped["Business"] = relationship(back_populates="outreach_records")
