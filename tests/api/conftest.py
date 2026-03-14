import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
os.environ["API_KEY"] = "test-api-key"

from leadforge.api.app import app
from leadforge.api.deps import get_db
from leadforge.db.models.base import Base
from leadforge.db.models.business import Business, NicheType, LicenseStatus
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.db.models.lead_score import LeadScore
from leadforge.db.models.outreach_record import OutreachRecord, PipelineStage


def _create_tables_without_postgis(conn):
    """Create all tables but swap PostGIS Geometry columns to String for SQLite."""
    from sqlalchemy import String as SAString
    from geoalchemy2 import Geometry

    # Temporarily swap Geometry columns to String
    swapped = []
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, Geometry):
                swapped.append((col, col.type))
                col.type = SAString()

    Base.metadata.create_all(conn)

    # Restore original types
    for col, orig_type in swapped:
        col.type = orig_type


@pytest_asyncio.fixture
async def db_session():
    """Create a fresh in-memory SQLite database for each test."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        # Register stub spatial functions so GeoAlchemy2 INSERT/SELECT works on SQLite
        for fn_name in ("GeomFromEWKT", "ST_AsEWKB", "AsEWKB", "ST_GeomFromEWKT"):
            dbapi_conn.create_function(fn_name, 1, lambda x: x)
        dbapi_conn.create_function("RecoverGeometryColumn", 5, lambda *a: None)
        dbapi_conn.create_function("DiscardGeometryColumn", 3, lambda *a: None)

    async with engine.begin() as conn:
        await conn.run_sync(_create_tables_without_postgis)

    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest_asyncio.fixture
async def client(db_session: AsyncSession):
    """HTTP test client with DB session override."""
    async def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def auth_headers():
    return {"X-API-Key": "test-api-key"}


@pytest_asyncio.fixture
async def sample_business(db_session: AsyncSession) -> Business:
    """Insert a sample business into the test DB."""
    biz = Business(
        id=uuid.uuid4(),
        name="Test Barbershop",
        zip_code="60619",
        niche=NicheType.BARBERSHOPS,
        address="123 Test St",
        phone="(773) 555-0001",
        license_status=LicenseStatus.ACTIVE,
    )
    db_session.add(biz)
    await db_session.commit()
    await db_session.refresh(biz)
    return biz


@pytest_asyncio.fixture
async def sample_business_with_score(db_session: AsyncSession, sample_business: Business) -> tuple[Business, LeadScore]:
    """Insert a business with a lead score."""
    score = LeadScore(
        id=uuid.uuid4(),
        business_id=sample_business.id,
        score_version=1,
        digital_deficit_score=65.0,
        viability_score=45.0,
        competitive_pressure_score=30.0,
        composite_acquisition_score=48.25,
        price_tier=2,
    )
    db_session.add(score)
    await db_session.commit()
    return sample_business, score


@pytest_asyncio.fixture
async def sample_outreach(db_session: AsyncSession, sample_business: Business) -> OutreachRecord:
    """Insert a sample outreach record."""
    outreach = OutreachRecord(
        id=uuid.uuid4(),
        business_id=sample_business.id,
        status=PipelineStage.SCORED,
    )
    db_session.add(outreach)
    await db_session.commit()
    await db_session.refresh(outreach)
    return outreach
