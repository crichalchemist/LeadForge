import structlog

from leadforge.config import settings
from leadforge.db.models.business import NicheType
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()

# Maps our niche types to Socrata business_activity search terms
# Chicago Data Portal business licenses dataset: data.cityofchicago.org resource ID "r5kz-chrr"
# Terms validated against live dataset 2026-03-14
NICHE_MAPPING: dict[NicheType, list[str]] = {
    NicheType.BARBERSHOPS: ["hair service"],
    NicheType.NAIL_SALONS: ["nail service"],
    NicheType.BEAUTY_SHOPS: ["hair, nail, and skin care", "hair service"],
    NicheType.BEAUTY_SUPPLY: ["hair service", "nail service"],
    NicheType.TIRE_SHOPS: ["sale and storage of tires"],
    NicheType.BARS: ["tavern"],
    NicheType.SMOKE_SHOPS: ["tobacco"],
    NicheType.MEAT_MARKETS: ["butcher"],
    NicheType.TOWING: ["tow truck", "tow storage"],
    NicheType.LAWN_SERVICES: ["landscap"],
    NicheType.MOBILE_MECHANICS: ["motor vehicle repair"],
    NicheType.USED_AUTO_PARTS: ["junk peddler"],
    NicheType.SEPTIC_SERVICES: ["plumb"],
    NicheType.VETERINARIANS: ["veterinar"],
    NicheType.SECURITY_SERVICES: ["security service"],
}


class SocrataClient(BaseAPIClient):
    """Client for Chicago Data Portal (Socrata) business licenses."""

    DATASET_ID = "r5kz-chrr"  # Business Licenses dataset

    def __init__(self):
        super().__init__(base_url="https://data.cityofchicago.org")

    async def search_businesses(
        self, zip_code: str, niche: NicheType, limit: int | None = None
    ) -> list[dict]:
        """Search businesses by zip code and niche using SoQL."""
        page_size = settings.SOCRATA_PAGE_SIZE
        if limit and limit < page_size:
            page_size = limit

        search_terms = NICHE_MAPPING.get(niche, [])
        if not search_terms:
            logger.warning("no_niche_mapping", niche=niche.value)
            return []

        # Build WHERE clause: zip_code match AND (term1 OR term2 OR ...)
        term_conditions = " OR ".join(
            f"upper(business_activity) like upper('%{term}%')" for term in search_terms
        )
        where_clause = f"zip_code='{zip_code}' AND ({term_conditions})"

        all_results = []
        offset = 0

        client = await self._get_client()

        while True:
            params = {
                "$where": where_clause,
                "$limit": page_size,
                "$offset": offset,
                "$order": "legal_name ASC",
            }
            if settings.SOCRATA_APP_TOKEN:
                params["$$app_token"] = settings.SOCRATA_APP_TOKEN

            response = await client.get(
                f"/resource/{self.DATASET_ID}.json",
                params=params,
            )
            response.raise_for_status()
            page = response.json()

            if not page:
                break

            all_results.extend(page)
            logger.info(
                "socrata_page_fetched",
                zip_code=zip_code,
                niche=niche.value,
                count=len(page),
                total=len(all_results),
            )

            if len(page) < page_size:
                break
            if limit and len(all_results) >= limit:
                all_results = all_results[:limit]
                break

            offset += page_size

        return all_results

    def normalize_result(self, raw: dict, niche: NicheType) -> dict:
        """Normalize a Socrata result into our Business-compatible dict."""
        return {
            "name": raw.get("doing_business_as_name") or raw.get("legal_name", ""),
            "address": raw.get("address", ""),
            "zip_code": raw.get("zip_code", ""),
            "phone": None,  # Not in Socrata data
            "niche": niche,
            "license_number": raw.get("license_number"),
            "license_status": self._map_license_status(raw.get("license_status")),
            "license_issue_date": raw.get("license_start_date"),
        }

    @staticmethod
    def _map_license_status(status: str | None) -> str:
        # Dataset legend: AAI = license issued, AAC = cancelled during its term,
        # REV = revoked, REA = revocation appealed.
        if not status:
            return "unknown"
        status_lower = status.lower()
        if "aai" in status_lower or "active" in status_lower:
            return "active"
        if "rev" in status_lower:
            return "revoked"
        return "expired"
