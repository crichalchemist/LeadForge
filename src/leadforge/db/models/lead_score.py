import uuid
from typing import Optional
from sqlalchemy import Integer, Float, String, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin


class LeadScore(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "lead_scores"
    __table_args__ = (
        UniqueConstraint("business_id", "score_version", name="uq_business_score_version"),
    )

    business_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("businesses.id", ondelete="CASCADE"))
    score_version: Mapped[int] = mapped_column(Integer, default=1)

    # Sub-scores (0-100 each)
    digital_deficit_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    viability_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    competitive_pressure_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Composite
    composite_acquisition_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Price tier (1, 2, or 3)
    price_tier: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Sentiment adjustment factor
    sentiment_adjustment: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationship
    business: Mapped["Business"] = relationship(back_populates="lead_scores")
