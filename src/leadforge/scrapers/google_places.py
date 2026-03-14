import base64
import hashlib
import hmac
from urllib.parse import urlencode, urlparse

import structlog

from leadforge.config import settings
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()

# Use field masks to control API costs
# Basic fields (no charge): place_id, name, formatted_address, geometry, types
# Contact fields ($0.003): formatted_phone_number, website, opening_hours
# Atmosphere fields ($0.005): reviews, rating, user_ratings_total
FIND_PLACE_FIELDS = "place_id,name,formatted_address,geometry"
DETAIL_FIELDS = (
    "place_id,name,formatted_address,geometry/location,"
    "formatted_phone_number,website,rating,user_ratings_total,"
    "business_status,opening_hours,reviews"
)


def _sign_url(url: str, secret: str) -> str:
    """Sign a Google Maps API URL with HMAC-SHA1 using the API secret."""
    parsed = urlparse(url)
    url_to_sign = parsed.path + "?" + parsed.query
    decoded_key = base64.urlsafe_b64decode(secret)
    signature = hmac.new(decoded_key, url_to_sign.encode(), hashlib.sha1)
    encoded_sig = base64.urlsafe_b64encode(signature.digest()).decode()
    return url + "&signature=" + encoded_sig


class GooglePlacesClient(BaseAPIClient):
    """Client for Google Places API with URL signing."""

    def __init__(self):
        super().__init__(base_url="https://maps.googleapis.com")

    def _build_signed_url(self, path: str, params: dict) -> str:
        """Build a signed URL for Google Maps API requests."""
        params["key"] = settings.GOOGLE_PLACES_API_KEY
        url = f"https://maps.googleapis.com{path}?{urlencode(params)}"
        if settings.GOOGLE_PLACES_API_SECRET:
            return _sign_url(url, settings.GOOGLE_PLACES_API_SECRET)
        return url

    async def find_place(self, business_name: str, address: str) -> dict | None:
        """Find a place by name+address text search. Returns basic place info."""
        if not settings.GOOGLE_PLACES_API_KEY:
            logger.warning("google_places_api_key_not_set")
            return None

        signed_url = self._build_signed_url(
            "/maps/api/place/findplacefromtext/json",
            {
                "input": f"{business_name} {address}",
                "inputtype": "textquery",
                "fields": FIND_PLACE_FIELDS,
            },
        )

        client = await self._get_client()
        response = await client.get(signed_url)
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

        signed_url = self._build_signed_url(
            "/maps/api/place/details/json",
            {
                "place_id": place_id,
                "fields": DETAIL_FIELDS,
            },
        )

        client = await self._get_client()
        response = await client.get(signed_url)
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
