import uuid
from typing import Optional
from sqlalchemy import String, Integer, Float, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin
from leadforge.db.models.business import NicheType
from sqlalchemy import Enum as SAEnum


class CompetitiveContext(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "competitive_contexts"
    __table_args__ = (
        UniqueConstraint("zip_code", "niche", name="uq_zip_niche"),
    )

    zip_code: Mapped[str] = mapped_column(String(10), index=True)
    niche: Mapped[NicheType] = mapped_column(SAEnum(NicheType, create_constraint=False))

    # Competitive metrics
    competitor_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_digital_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    competitor_ads_active_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Demographics (from Census API)
    median_household_income: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    population_density: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
