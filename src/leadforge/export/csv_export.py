import csv
from pathlib import Path

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from leadforge.db.models.business import Business, NicheType
from leadforge.db.models.lead_score import LeadScore


async def export_leads_csv(
    session: AsyncSession,
    output_path: str | Path,
    zip_code: str | None = None,
    niche: str | None = None,
    min_score: float | None = None,
) -> int:
    """Export scored leads to CSV. Returns count of exported leads."""

    # Build query
    query = (
        select(Business, LeadScore)
        .join(LeadScore, Business.id == LeadScore.business_id)
        .order_by(desc(LeadScore.composite_acquisition_score))
    )

    if zip_code:
        query = query.where(Business.zip_code == zip_code)
    if niche:
        try:
            niche_enum = NicheType(niche)
            query = query.where(Business.niche == niche_enum)
        except ValueError:
            pass
    if min_score is not None:
        query = query.where(LeadScore.composite_acquisition_score >= min_score)

    result = await session.execute(query)
    rows = result.all()

    output_path = Path(output_path)
    with output_path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "name",
                "address",
                "zip_code",
                "phone",
                "niche",
                "google_place_id",
                "license_status",
                "digital_deficit_score",
                "composite_score",
                "price_tier",
            ]
        )

        for business, score in rows:
            writer.writerow(
                [
                    business.name,
                    business.address or "",
                    business.zip_code,
                    business.phone or "",
                    business.niche.value if business.niche else "",
                    business.google_place_id or "",
                    business.license_status.value if business.license_status else "",
                    f"{score.digital_deficit_score:.1f}"
                    if score.digital_deficit_score
                    else "",
                    f"{score.composite_acquisition_score:.1f}"
                    if score.composite_acquisition_score
                    else "",
                    score.price_tier or "",
                ]
            )

    return len(rows)
