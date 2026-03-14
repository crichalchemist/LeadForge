from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from leadforge.db.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from leadforge.db.models.business import Business


class DigitalPresence(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "digital_presences"

    business_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="CASCADE"), unique=True
    )

    # Website
    has_website: Mapped[bool] = mapped_column(Boolean, default=False)
    website_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    website_quality_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    has_ssl: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    domain_registration_date: Mapped[Optional[str]] = mapped_column(
        String(50), nullable=True
    )

    # Google Business Profile
    has_google_business_profile: Mapped[bool] = mapped_column(Boolean, default=False)
    gbp_completeness_score: Mapped[Optional[float]] = mapped_column(
        Float, nullable=True
    )
    google_review_count: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    google_avg_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    review_velocity_30d: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Social media
    has_facebook_page: Mapped[bool] = mapped_column(Boolean, default=False)
    has_instagram: Mapped[bool] = mapped_column(Boolean, default=False)
    fb_last_post_days_ago: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ig_follower_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ig_post_frequency: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Advertising
    has_google_ads: Mapped[bool] = mapped_column(Boolean, default=False)
    has_meta_ads: Mapped[bool] = mapped_column(Boolean, default=False)

    # Yelp (Phase 2)
    yelp_review_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    yelp_rating: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # Relationship
    business: Mapped["Business"] = relationship(back_populates="digital_presence")
