import structlog
from leadforge.scrapers.base import BaseAPIClient
from leadforge.config import settings

logger = structlog.get_logger()

# Use field masks to control API costs
# Basic fields (no charge): place_id, name, formatted_address, geometry, types
# Contact fields ($0.003): formatted_phone_number, website, opening_hours
# Atmosphere fields ($0.005): reviews, rating, user_ratings_total
FIND_PLACE_FIELDS = "place_id,name,formatted_address,geometry"
DETAIL_FIELDS = "place_id,name,formatted_address,geometry/location,formatted_phone_number,website,rating,user_ratings_total,business_status,opening_hours,reviews"

class GooglePlacesClient(BaseAPIClient):
    """Client for Google Places API."""

    def __init__(self):
        super().__init__(base_url="https://maps.googleapis.com")

    async def find_place(self, business_name: str, address: str) -> dict | None:
        """Find a place by name+address text search. Returns basic place info."""
        if not settings.GOOGLE_PLACES_API_KEY:
            logger.warning("google_places_api_key_not_set")
            return None

        client = await self._get_client()
        response = await client.get(
            "/maps/api/place/findplacefromtext/json",
            params={
                "input": f"{business_name} {address}",
                "inputtype": "textquery",
                "fields": FIND_PLACE_FIELDS,
                "key": settings.GOOGLE_PLACES_API_KEY,
            },
        )
        response.raise_for_status()
        data = response.json()

        candidates = data.get("candidates", [])
        if not candidates:
            logger.info("google_place_not_found", name=business_name)
            return None

        return candidates[0]

    async def get_place_details(self, place_id: str) -> dict | None:
        """Get detailed place info by place_id. Uses field masks for cost control."""
        if not settings.GOOGLE_PLACES_API_KEY:
            return None

        client = await self._get_client()
        response = await client.get(
            "/maps/api/place/details/json",
            params={
                "place_id": place_id,
                "fields": DETAIL_FIELDS,
                "key": settings.GOOGLE_PLACES_API_KEY,
            },
        )
        response.raise_for_status()
        data = response.json()

        result = data.get("result")
        if not result:
            logger.info("google_place_details_not_found", place_id=place_id)
            return None

        return result

    def extract_enrichment(self, details: dict) -> dict:
        """Extract enrichment data from Place Details response."""
        geometry = details.get("geometry", {})
        location = geometry.get("location", {})

        return {
            "google_place_id": details.get("place_id"),
            "name": details.get("name"),
            "address": details.get("formatted_address"),
            "phone": details.get("formatted_phone_number"),
            "website": details.get("website"),
            "latitude": location.get("lat"),
            "longitude": location.get("lng"),
            "google_review_count": details.get("user_ratings_total", 0),
            "google_avg_rating": details.get("rating"),
            "has_website": bool(details.get("website")),
            "has_google_business_profile": True,  # If we got details, GBP exists
        }
