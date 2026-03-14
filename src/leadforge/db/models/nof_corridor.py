import enum
from typing import Optional
from datetime import datetime
from sqlalchemy import String, DateTime, Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column
from geoalchemy2 import Geometry
from leadforge.db.models.base import Base, UUIDPrimaryKeyMixin, TimestampMixin


class CorridorType(str, enum.Enum):
    ELIGIBLE = "eligible"
    PRIORITY = "priority"


class NOFCorridor(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "nof_corridors"

    corridor_name: Mapped[str] = mapped_column(String(255))
    corridor_type: Mapped[CorridorType] = mapped_column(SAEnum(CorridorType))

    # PostGIS geometry
    geometry: Mapped[Optional[str]] = mapped_column(Geometry("MULTILINESTRING", srid=4326), nullable=True)

    # Source tracking
    source_updated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    fetched_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
