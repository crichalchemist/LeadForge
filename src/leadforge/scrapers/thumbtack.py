import structlog
from leadforge.scrapers.base import BaseAPIClient

logger = structlog.get_logger()

class ThumbtackClient(BaseAPIClient):
    """Thumbtack business scraper."""

    def __init__(self):
        super().__init__(base_url="https://www.thumbtack.com", timeout=30.0)

    async def search_business(self, name: str, zip_code: str) -> dict | None:
        """Search for a business on Thumbtack. Returns profile data or None."""
        try:
            client = await self._get_client()
            response = await client.get(
                "/s/",
                params={"search_term": name, "zip_code": zip_code},
                headers={"Accept": "text/html"},
            )
            response.raise_for_status()
            text = response.text

            import re
            import json

            # Try to extract structured data from page
            script_match = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', text, re.DOTALL)
            if script_match:
                try:
                    ld_json = json.loads(script_match.group(1))
                    return {
                        "thumbtack_name": ld_json.get("name"),
                        "thumbtack_rating": ld_json.get("aggregateRating", {}).get("ratingValue"),
                        "thumbtack_review_count": ld_json.get("aggregateRating", {}).get("reviewCount"),
                        "thumbtack_hires": None,  # Not in LD+JSON, needs deeper parsing
                    }
                except json.JSONDecodeError:
                    pass

            return None
        except Exception as e:
            logger.warning("thumbtack_search_failed", error=str(e), name=name)
            return None
