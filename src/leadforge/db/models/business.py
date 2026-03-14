import uuid
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Integer, Float, Date, Enum as SAEnum, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from geoalchemy2 import Geometry
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin
import enum


class LicenseStatus(str, enum.Enum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    UNKNOWN = "unknown"


class NicheType(str, enum.Enum):
    SEPTIC_SERVICES = "septic_services"
    USED_AUTO_PARTS = "used_auto_parts"
    MEAT_MARKETS = "meat_markets"
    BARS = "bars"
    NAIL_SALONS = "nail_salons"
    BEAUTY_SHOPS = "beauty_shops"
    SMOKE_SHOPS = "smoke_shops"
    BEAUTY_SUPPLY = "beauty_supply"
    MOBILE_MECHANICS = "mobile_mechanics"
    TIRE_SHOPS = "tire_shops"
    LAWN_SERVICES = "lawn_services"
    TOWING = "towing"
    BARBERSHOPS = "barbershops"
    VETERINARIANS = "veterinarians"
    SECURITY_SERVICES = "security_services"


class Business(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "businesses"

    # Core fields
    name: Mapped[str] = mapped_column(String(255))
    address: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    zip_code: Mapped[str] = mapped_column(String(10), index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    owner_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    niche: Mapped[NicheType] = mapped_column(SAEnum(NicheType), index=True)

    # License/registration
    license_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    license_status: Mapped[Optional[LicenseStatus]] = mapped_column(SAEnum(LicenseStatus), nullable=True)
    license_issue_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    incorporation_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Business metrics
    employee_count_est: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_monthly_revenue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    # External IDs
    google_place_id: Mapped[Optional[str]] = mapped_column(String(255), unique=True, nullable=True)

    # Social/platform metrics (populated in Phase 2, nullable for now)
    thumbtack_hires: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    nextdoor_recommendations: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ig_location_tag_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    ig_hashtag_mention_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fb_checkin_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    fb_ugc_tag_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_customer_ugc: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # PostGIS geometry
    location: Mapped[Optional[str]] = mapped_column(Geometry("POINT", srid=4326), nullable=True)

    # Relationships
    digital_presence: Mapped[Optional["DigitalPresence"]] = relationship(back_populates="business", uselist=False, cascade="all, delete-orphan")
    lead_scores: Mapped[list["LeadScore"]] = relationship(back_populates="business", cascade="all, delete-orphan")
    outreach_records: Mapped[list["OutreachRecord"]] = relationship(back_populates="business", cascade="all, delete-orphan")
