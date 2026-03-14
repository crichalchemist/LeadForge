import uuid
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.business import Business, NicheType, LicenseStatus
from leadforge.db.models.digital_presence import DigitalPresence
from leadforge.db.models.lead_score import LeadScore
from leadforge.scrapers.socrata import SocrataClient
from leadforge.scrapers.google_places import GooglePlacesClient
from leadforge.scoring.digital_deficit import compute_digital_deficit

logger = structlog.get_logger()


async def run_discovery(
    session: AsyncSession,
    zip_code: str,
    niche: NicheType,
    limit: int | None = None,
) -> list[Business]:
    """Run the full discovery pipeline: Socrata → Google Places → Score → Persist."""

    logger.info("pipeline_start", zip_code=zip_code, niche=niche.value, limit=limit)

    # Step 1: Query Socrata for businesses and normalize
    async with SocrataClient() as socrata:
        raw_results = await socrata.search_businesses(zip_code, niche, limit=limit)
        logger.info("socrata_results", count=len(raw_results))

        if not raw_results:
            logger.info("no_socrata_results", zip_code=zip_code, niche=niche.value)
            return []

        # Step 2: Normalize Socrata results (inside context manager)
        normalized = []
        for raw in raw_results:
            normalized.append(socrata.normalize_result(raw, niche))

    # Step 3: Enrich via Google Places + dedup
    persisted = []
    async with GooglePlacesClient() as google:
        for biz_data in normalized:
            try:
                business = await _enrich_and_persist(session, google, biz_data, niche)
                if business:
                    persisted.append(business)
            except Exception as e:
                logger.error("business_enrichment_failed", name=biz_data.get("name"), error=str(e))
                continue

    await session.commit()
    logger.info("pipeline_complete", persisted_count=len(persisted))
    return persisted


async def _enrich_and_persist(
    session: AsyncSession,
    google: GooglePlacesClient,
    biz_data: dict,
    niche: NicheType,
) -> Business | None:
    """Enrich a single business via Google Places, dedup, score, and persist."""

    name = biz_data.get("name", "").strip()
    if not name:
        return None

    address = biz_data.get("address", "")
    zip_code = biz_data.get("zip_code", "")

    # Try Google Places enrichment
    enrichment = {}
    place = await google.find_place(name, f"{address}, Chicago, IL {zip_code}")
    if place:
        place_id = place.get("place_id")
        if place_id:
            # Dedup check: does a business with this google_place_id already exist?
            existing = await session.execute(
                select(Business).where(Business.google_place_id == place_id)
            )
            if existing.scalar_one_or_none():
                logger.info("dedup_google_place_id", name=name, place_id=place_id)
                return None

            details = await google.get_place_details(place_id)
            if details:
                enrichment = google.extract_enrichment(details)
    else:
        # Fallback dedup: fuzzy name + zip
        existing = await session.execute(
            select(Business).where(
                Business.name == name,
                Business.zip_code == zip_code,
            )
        )
        if existing.scalar_one_or_none():
            logger.info("dedup_name_zip", name=name, zip_code=zip_code)
            return None

    # Map license status string to enum
    license_status_str = biz_data.get("license_status", "unknown")
    try:
        license_status = LicenseStatus(license_status_str)
    except ValueError:
        license_status = LicenseStatus.UNKNOWN

    # Create Business entity
    business = Business(
        id=uuid.uuid4(),
        name=enrichment.get("name", name),
        address=enrichment.get("address", address),
        zip_code=zip_code,
        phone=enrichment.get("phone"),
        niche=niche,
        license_number=biz_data.get("license_number"),
        license_status=license_status,
        google_place_id=enrichment.get("google_place_id"),
    )

    # Handle lat/lng for PostGIS point
    lat = enrichment.get("latitude")
    lng = enrichment.get("longitude")
    if lat and lng:
        from geoalchemy2.elements import WKTElement
        business.location = WKTElement(f"POINT({lng} {lat})", srid=4326)

    session.add(business)

    # Create DigitalPresence
    dp = DigitalPresence(
        id=uuid.uuid4(),
        business_id=business.id,
        has_website=enrichment.get("has_website", False),
        website_url=enrichment.get("website"),
        has_google_business_profile=enrichment.get("has_google_business_profile", False),
        google_review_count=enrichment.get("google_review_count", 0),
        google_avg_rating=enrichment.get("google_avg_rating"),
    )
    session.add(dp)

    # Compute digital deficit score
    deficit_score = compute_digital_deficit(dp)

    # Create LeadScore (Phase 1: only digital deficit, others null)
    lead_score = LeadScore(
        id=uuid.uuid4(),
        business_id=business.id,
        score_version=1,
        digital_deficit_score=deficit_score,
        composite_acquisition_score=deficit_score,  # Phase 1: composite = deficit only
    )
    session.add(lead_score)

    logger.info("business_persisted", name=business.name, score=deficit_score)
    return business
